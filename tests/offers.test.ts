import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Message from '../src/models/Message';
import Conversation from '../src/models/Conversation';
import Listing from '../src/models/Listing';
import Category from '../src/models/Category';
import Subcategory from '../src/models/Subcategory';
import User from '../src/models/User';
import { sendMessage, listMessages } from '../src/controllers/conversation.controller';

const buyer = '507f1f77bcf86cd799439011', seller = '507f1f77bcf86cd799439012', target = '507f1f77bcf86cd799439013';
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const conversation = { _id: oid(target), kind: 'listing', targetId: oid(target), initiatorId: oid(buyer), ownerId: oid(seller), participants: [oid(buyer), oid(seller)], buyerInterestNotificationQueued: true };
function response() { return { code: 200, body: null as any, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } }; }
function chain(value: unknown) { const query: any = {}; for (const method of ['sort','select','limit']) query[method] = () => query; query.lean = async () => value; return query; }
function setup(t: any, data = conversation) {
  t.mock.method(Conversation, 'findOne', () => chain(data));
  t.mock.method(Listing, 'findOne', () => chain({ _id: oid(target), sellerId: oid(seller), title: 'Desk', price: 1000, coverImage: null }));
  t.mock.method(Category, 'exists', async () => true);
  t.mock.method(Subcategory, 'exists', async () => true);
  t.mock.method(User, 'exists', async () => true);
  t.mock.method(Conversation, 'updateOne', async () => ({}));
}

test('offer messages store a numeric amount and a server-generated inbox preview; retries are idempotent', async t => {
  setup(t);
  const stored = new Map();
  let writes = 0;
  t.mock.method(Message, 'findOneAndUpdate', async (filter: any, changes: any) => {
    assert.equal(filter.senderId, buyer);
    if (!stored.has(filter.clientId)) { writes++; stored.set(filter.clientId, { ...changes.$setOnInsert, _id: oid(target), createdAt: new Date() }); }
    return stored.get(filter.clientId);
  });
  const req = { userId: buyer, params: { conversationId: target }, body: { kind: 'offer', offerAmount: 950.5, text: 'forged text', clientId: 'offer_client_123', senderId: seller } };
  const first = response(); await sendMessage(req as any, first as any);
  await sendMessage(req as any, response() as any);
  assert.equal(writes, 1); assert.equal(first.code, 201);
  assert.equal(first.body.data.kind, 'offer'); assert.equal(first.body.data.offerAmount, 950.5);
  assert.equal(first.body.data.text, 'Offer: INR 950.5');
  assert.equal(first.body.data.senderId, buyer);
  await sendMessage({ ...req, body: { ...req.body, offerAmount: 900, clientId: 'revised_client_123' } } as any, response() as any);
  assert.equal(writes, 2); assert.equal(stored.get('offer_client_123').offerAmount, 950.5);
});

test('invalid offers, seller offers, and offers on needs are rejected', async t => {
  setup(t);
  const req = { userId: buyer, params: { conversationId: target }, body: { kind: 'offer', offerAmount: 900, clientId: 'offer_client_123' } };
  for (const amount of [0, -1, NaN, Infinity, '900', 1.001, 1000000000001]) await assert.rejects(sendMessage({ ...req, body: { ...req.body, offerAmount: amount } } as any, response() as any), /valid offer amount/);
  await assert.rejects(sendMessage({ ...req, userId: seller } as any, response() as any), /Only the buyer/);
  t.mock.method(Conversation, 'findOne', () => chain({ ...conversation, kind: 'need' }));
  await assert.rejects(sendMessage(req as any, response() as any), /Only the buyer/);
});

test('latest offer metadata is returned even when it is outside the loaded message page', async t => {
  setup(t);
  const latest = { _id: target, senderId: buyer, kind: 'offer', offerAmount: 900, createdAt: new Date() };
  let offerFilter: any;
  t.mock.method(Message, 'find', () => chain([{ _id: oid(target), senderId: seller, kind: 'text', text: 'Hello' }]));
  t.mock.method(Message, 'findOne', (filter: any) => { offerFilter = filter; return chain(latest); });
  t.mock.method(Message, 'updateMany', async () => ({}));
  t.mock.method(User, 'find', () => chain([{ _id: oid(buyer), name: 'Buyer', accountStatus: 'active' }, { _id: oid(seller), name: 'Seller', accountStatus: 'active' }]));
  for (const viewer of [buyer, seller]) {
    const res = response();
    await listMessages({ userId: viewer, params: { conversationId: target }, query: { before: target } } as any, res as any);
    assert.equal(res.body.latestOffer.offerAmount, 900);
    assert.equal(res.body.canOffer, viewer === buyer);
    assert.equal(res.body.listing.price, 1000);
    assert.equal(String(offerFilter.conversationId), target); assert.equal(offerFilter.kind, 'offer');
  }
});
