import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Listing from '../src/models/Listing';
import Conversation from '../src/models/Conversation';
import Message from '../src/models/Message';
import Category from '../src/models/Category';
import Subcategory from '../src/models/Subcategory';
import User from '../src/models/User';
import PushSubscription from '../src/models/PushSubscription';
import NotificationCampaign from '../src/models/NotificationCampaign';
import EmailNotification from '../src/models/EmailNotification';
import { reviewListing } from '../src/controllers/listing-admin.controller';
import { sendMessage } from '../src/controllers/conversation.controller';
import { listingReviewNotification, buyerInterestNotification } from '../src/models/notification-intent';
import { processAutomaticNotificationIntents } from '../src/services/automatic-notifications';
import { processNotificationBatch } from '../src/services/notification-worker';

const buyer = '507f1f77bcf86cd799439011', seller = '507f1f77bcf86cd799439012', listingId = '507f1f77bcf86cd799439013', conversationId = '507f1f77bcf86cd799439014';
const oid = (id: string) => new mongoose.Types.ObjectId(id);
function response() { return { code: 200, body: null as any, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } }; }
function chain(data: unknown) { const query: any = {}; for (const method of ['select', 'sort']) query[method] = () => query; query.lean = async () => data; return query; }

test('reconciliation includes hidden listing intents in the actual database projection', async t => {
  let queried = false;
  t.mock.method(Listing.collection, 'findOne', async (_filter: any, options: any) => {
    queried = true;
    assert.equal(options.projection.pendingNotifications, 1);
    assert.equal(options.projection._id, 1);
    return null;
  });
  t.mock.method(Conversation, 'findOne', () => chain(null) as any);
  await processAutomaticNotificationIntents();
  assert.equal(queried, true);
});

test('automatic queue metadata and embedded intents survive actual Mongoose validation', async () => {
  const intent = buyerInterestNotification({ conversationId, listingId, buyerId: buyer, sellerId: seller, title: 'Desk', offer: true });
  const campaign = new NotificationCampaign({ requestId: intent.requestId, fingerprint: intent.eventKey, eventKey: intent.eventKey, createdBy: buyer, title: intent.title, body: intent.body, screen: 'chat', audience: 'users', total: 1, recipients: [seller], type: intent.type, notificationData: { screen: 'chat', type: 'buyer_interest', listingId, conversationId } });
  await campaign.validate();
  assert.equal(campaign.notificationData?.screen, 'chat'); assert.equal(campaign.notificationData?.type, 'buyer_interest'); assert.equal(campaign.notificationData?.conversationId, conversationId);
  const conversation = new Conversation({ kind: 'listing', targetId: listingId, title: 'Desk', initiatorId: buyer, ownerId: seller, participants: [buyer, seller], pendingInterestNotification: intent });
  await conversation.validate(); assert.equal(conversation.pendingInterestNotification?.type, 'buyer_interest');
});

test('moderation persists notification and status together, targets owner, and suppresses unchanged/stale reviews', async t => {
  let status = 'pending'; const intents: any[] = [];
  const listing = { _id: listingId, sellerId: seller, title: 'Desk', categoryId: listingId, subcategoryId: listingId, coverImage: 'cover.jpg', media: [{ kind: 'image', url: 'cover.jpg' }] };
  t.mock.method(Listing, 'findById', () => chain({ ...listing, status }) as any);
  t.mock.method(Category, 'exists', async () => true); t.mock.method(Subcategory, 'exists', async () => true);
  t.mock.method(Listing, 'findOneAndUpdate', async (filter: any, update: any) => {
    const expected = filter.status || 'pending';
    if (status !== expected) return null;
    status = update.$set.status;
    if (update.$push?.pendingNotifications) intents.push(update.$push.pendingNotifications);
    return { ...listing, ...update.$set };
  });
  async function review(next: string, expected: string, reason = '') {
    const res = response();
    await reviewListing({ userId: buyer, params: { listingId }, body: { status: next, expectedStatus: expected, reason } } as any, res as any, (e: unknown) => { throw e; });
    return res;
  }
  assert.equal((await review('approved', 'pending')).code, 200);
  assert.equal(intents[0].recipientId, seller); assert.equal(intents[0].type, 'listing_approved'); assert.equal(intents[0].screen, 'my-ads');
  assert.equal((await review('approved', 'approved')).code, 200); assert.equal(intents.length, 1);
  assert.equal((await review('rejected', 'approved', 'Please upload a clearer photo.')).code, 200);
  assert.equal(intents[1].type, 'listing_rejected'); assert.match(intents[1].body, /clearer photo/);
  assert.equal((await review('approved', 'pending')).code, 409); assert.equal(intents.length, 2);
});

function setupMessages(t: any) {
  const conversation: any = { _id: oid(conversationId), kind: 'listing', targetId: oid(listingId), ownerId: oid(seller), initiatorId: oid(buyer), participants: [oid(buyer), oid(seller)], buyerInterestNotificationQueued: false };
  const messages = new Map<string, any>(); const intents: any[] = [];
  t.mock.method(Conversation, 'findOne', () => chain({ ...conversation }) as any);
  t.mock.method(Listing, 'findOne', () => chain({ _id: listingId, sellerId: seller, title: 'Desk', categoryId: listingId, subcategoryId: listingId }) as any);
  t.mock.method(Category, 'exists', async () => true); t.mock.method(Subcategory, 'exists', async () => true); t.mock.method(User, 'exists', async () => true);
  t.mock.method(Message, 'findOneAndUpdate', async (filter: any, update: any) => {
    if (!messages.has(filter.clientId)) messages.set(filter.clientId, { ...update.$setOnInsert, _id: new mongoose.Types.ObjectId(), createdAt: new Date() });
    return messages.get(filter.clientId);
  });
  t.mock.method(Message, 'findOne', () => chain([...messages.values()].filter(message => message.senderId === buyer).sort((a, b) => String(a._id).localeCompare(String(b._id)))[0]) as any);
  t.mock.method(Conversation, 'updateOne', async (filter: any, update: any) => {
    if (update.$set?.pendingInterestNotification && !conversation.pendingInterestNotification && !conversation.buyerInterestNotificationQueued) {
      assert.equal(filter.pendingInterestNotification.$exists, false);
      conversation.pendingInterestNotification = update.$set.pendingInterestNotification; intents.push(update.$set.pendingInterestNotification);
    }
    return {};
  });
  const send = (clientId: string, kind = 'text', sender = buyer) => sendMessage({ userId: sender, params: { conversationId }, body: { clientId, text: 'Is this available?', kind, ...(kind === 'offer' ? { offerAmount: 500 } : {}) } } as any, response() as any);
  return { send, messages, intents, conversation };
}

for (const first of ['text', 'offer']) test(`only the first buyer ${first} creates an interest notification, including retries and later messages`, async t => {
  const { send, intents, conversation } = setupMessages(t);
  await send('first_client_123', first); await send('first_client_123', first);
  await send('later_client_456', first === 'offer' ? 'text' : 'offer');
  assert.equal(intents.length, 1); assert.equal(intents[0].recipientId, seller);
  assert.equal(intents[0].eventKey, `buyer-interest:${conversationId}`); assert.equal(intents[0].conversationId, conversationId);
  assert.equal(intents[0].screen, 'chat'); assert.match(intents[0].body, /Start a chat now/);
  if (first === 'offer') assert.match(intents[0].body, /made an offer/);
  conversation.buyerInterestNotificationQueued = true; delete conversation.pendingInterestNotification;
  await send('after_queued_789'); assert.equal(intents.length, 1);
});

test('concurrent first buyer messages still persist only one interest intent', async t => {
  const { send, intents } = setupMessages(t);
  await Promise.all([send('concurrent_client_a'), send('concurrent_client_b', 'offer')]);
  assert.equal(intents.length, 1);
});

test('seller messages and established conversations do not generate buyer-interest alerts', async t => {
  const { send, messages, intents } = setupMessages(t);
  await send('seller_client_123', 'text', seller); assert.equal(intents.length, 0);
  messages.set('historical', { _id: oid('407f1f77bcf86cd799439011'), senderId: buyer });
  await send('new_client_123'); assert.equal(intents.length, 0);
});

test('a queue/ack interruption retries the persisted intent without creating another notification', async t => {
  t.mock.method(EmailNotification, 'updateOne', async () => ({}));
  const intent = listingReviewNotification({ listingId, sellerId: seller, reviewerId: buyer, title: 'Desk', status: 'approved', reason: '' });
  const queue = new Map(); let pending = true; let failAck = true;
  t.mock.method(Listing, 'findOne', () => chain(pending ? { _id: listingId, pendingNotifications: [intent] } : null) as any);
  t.mock.method(Listing, 'updateOne', async () => { if (failAck) { failAck = false; throw new Error('Database interrupted'); } pending = false; return {}; });
  t.mock.method(Conversation, 'findOne', () => chain(null) as any);
  t.mock.method(NotificationCampaign, 'updateOne', async (filter: any, update: any, options: any) => { assert.equal(options.upsert, true); if (!queue.has(filter.eventKey)) queue.set(filter.eventKey, update.$setOnInsert); return {}; });
  await assert.rejects(() => processAutomaticNotificationIntents(), /interrupted/);
  await processAutomaticNotificationIntents();
  assert.equal(pending, false); assert.equal(queue.size, 1);
  const record: any = [...queue.values()][0];
  assert.equal(record.requestId, intent.requestId); assert.deepEqual(record.batchKeys, [intent.requestId]); assert.deepEqual(record.recipients, [seller]);
});

test('interest reconciliation clears its pending intent only after queue persistence', async t => {
  t.mock.method(EmailNotification, 'updateOne', async () => ({}));
  const intent = buyerInterestNotification({ conversationId, listingId, buyerId: buyer, sellerId: seller, title: 'Desk', offer: true });
  t.mock.method(Listing, 'findOne', () => chain(null) as any);
  t.mock.method(Conversation, 'findOne', () => chain({ _id: conversationId, pendingInterestNotification: intent }) as any);
  let queued = false;
  t.mock.method(NotificationCampaign, 'updateOne', async (_filter: any, update: any) => { queued = true; assert.equal(update.$setOnInsert.notificationData.conversationId, conversationId); return {}; });
  t.mock.method(Conversation, 'updateOne', async (filter: any, update: any) => { assert.equal(queued, true); assert.equal(filter['pendingInterestNotification.eventKey'], intent.eventKey); assert.equal(update.$set.buyerInterestNotificationQueued, true); return {}; });
  await processAutomaticNotificationIntents();
});

test('automatic notification sends its chat destination and uses the original provider retry key', async t => {
  const previousKey = process.env.ONESIGNAL_REST_API_KEY; process.env.ONESIGNAL_REST_API_KEY = 'test-only-key';
  t.after(() => { if (previousKey === undefined) delete process.env.ONESIGNAL_REST_API_KEY; else process.env.ONESIGNAL_REST_API_KEY = previousKey; });
  const intent = buyerInterestNotification({ conversationId, listingId, buyerId: buyer, sellerId: seller, title: 'Desk', offer: false });
  t.mock.method(NotificationCampaign, 'findOneAndUpdate', (filter: any) => {
    assert.ok(filter.$or.some((entry: any) => entry.status === 'failed' && entry.attempts.$lt === 5));
    return chain({ _id: conversationId, type: 'buyer_interest', title: intent.title, body: intent.body, screen: 'chat', total: 1, cursor: 0, recipients: [seller], batchKeys: [intent.requestId], notificationData: { screen: 'chat', type: 'buyer_interest', conversationId, listingId } }) as any;
  });
  t.mock.method(PushSubscription, 'distinct', async () => [seller]); t.mock.method(User, 'find', () => chain([{ _id: seller }]) as any);
  t.mock.method(NotificationCampaign, 'updateOne', async (_filter: any, update: any) => { assert.equal(update.$set.status, 'submitted'); return {}; });
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
    const body = JSON.parse(options.body); assert.equal(body.idempotency_key, intent.requestId);
    assert.deepEqual(body.include_aliases.external_id, [seller]); assert.equal(body.data.screen, 'chat'); assert.equal(body.data.conversationId, conversationId);
    return { ok: true, json: async () => ({ id: 'notification-id' }) } as any;
  });
  await processNotificationBatch();
});

test('existing promotions retain their destination when automatic metadata is absent or empty', async t => {
  const previousKey = process.env.ONESIGNAL_REST_API_KEY; process.env.ONESIGNAL_REST_API_KEY = 'test-only-key';
  t.after(() => { if (previousKey === undefined) delete process.env.ONESIGNAL_REST_API_KEY; else process.env.ONESIGNAL_REST_API_KEY = previousKey; });
  const intent = buyerInterestNotification({ conversationId, listingId, buyerId: buyer, sellerId: seller, title: 'Desk', offer: false });
  t.mock.method(NotificationCampaign, 'findOneAndUpdate', () => chain({ _id: conversationId, type: 'promotion', title: 'Sell nearby', body: 'Post your item', screen: 'sell', notificationData: {}, total: 1, cursor: 0, recipients: [seller], batchKeys: [intent.requestId] }) as any);
  t.mock.method(PushSubscription, 'distinct', async () => [seller]); t.mock.method(User, 'find', () => chain([{ _id: seller }]) as any);
  t.mock.method(NotificationCampaign, 'updateOne', async () => ({}));
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
    assert.deepEqual(JSON.parse(options.body).data, { screen: 'sell', type: 'promotion' });
    return { ok: true, json: async () => ({ id: 'promotion-id' }) } as any;
  });
  await processNotificationBatch();
});
