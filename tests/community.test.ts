import Feedback from '../src/models/Feedback';
import SupportMessage from '../src/models/SupportMessage';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../src/models/User';
import Listing from '../src/models/Listing';
import Wishlist from '../src/models/Wishlist';
import Need from '../src/models/Need';
import Category from '../src/models/Category';
import Subcategory from '../src/models/Subcategory';
import Conversation from '../src/models/Conversation';
import Message from '../src/models/Message';
import EmailOTP from '../src/models/EmailOTP';
import PushSubscription from '../src/models/PushSubscription';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { saveWishlist, removeWishlist, listWishlist, wishlistState } from '../src/controllers/wishlist.controller';
import { createNeed, setNeedOpen, listNeeds, reviewNeed } from '../src/controllers/need.controller';
import { startConversation, memberConversation, sendMessage, listMessages } from '../src/controllers/conversation.controller';
import { deleteUser, userStatus } from '../src/controllers/user-admin.controller';

const actor = '507f1f77bcf86cd799439011', owner = '507f1f77bcf86cd799439012', target = '507f1f77bcf86cd799439013';
const oid = (id: string) => new mongoose.Types.ObjectId(id);
function response() { return { code: 200, body: null as any, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } }; }
function chain(data: unknown) {
  const query: any = {};
  for (const name of ['sort', 'skip', 'limit', 'populate', 'select', 'session']) query[name] = () => query;
  query.lean = async () => data;
  return query;
}

test('wishlist save derives owner from authentication and is idempotent', async t => {
  t.mock.method(Listing, 'findOne', () => chain({ sellerId: owner }));
  t.mock.method(User, 'exists', async () => true);
  let filter: any, options: any;
  t.mock.method(Wishlist, 'updateOne', async (query: any, _update: any, opts: any) => { filter = query; options = opts; });
  const req = { params: { listingId: target }, userId: actor, body: { userId: owner } };
  await saveWishlist(req as any, response() as any);
  assert.deepEqual(filter, { userId: actor, listingId: target });
  assert.equal(options.upsert, true);
});
test('wishlist cannot save unpublished or deactivated seller items', async t => {
  t.mock.method(Listing, 'findOne', () => chain(null));
  await assert.rejects(saveWishlist({ params: { listingId: target }, userId: actor } as any, response() as any), /no longer available/);
});
test('wishlist removal and state queries are scoped to authenticated user', async t => {
  let filter: any;
  t.mock.method(Wishlist, 'deleteOne', async (query: any) => { filter = query; });
  await removeWishlist({ params: { entryId: target }, userId: actor } as any, response() as any);
  assert.deepEqual(filter, { _id: target, userId: actor });
  t.mock.method(Wishlist, 'findOne', (query: any) => { filter = query; return chain(null); });
  const res = response();
  await wishlistState({ params: { listingId: target }, userId: actor } as any, res as any);
  assert.equal(filter.userId, actor); assert.equal(res.body.data.saved, false);
});
test('wishlist responses mark unavailable entries and omit seller private details', async t => {
  let filter: any;
  t.mock.method(Wishlist, 'find', (query: any) => { filter = query; return chain([{ _id: target, listingId: { _id: target, title: 'Desk', price: 200, location: 'Pune', coverImage: null, status: 'pending', sellerId: { accountStatus: 'active', email: 'private@example.test' } } }]); });
  t.mock.method(Wishlist, 'countDocuments', async () => 1);
  const res = response();
  await listWishlist({ userId: actor, query: { userId: owner } } as any, res as any);
  assert.equal(filter.userId, actor); assert.equal(res.body.data[0].available, false);
  assert.equal(JSON.stringify(res.body).includes('private@example.test'), false);
});
test('new needs force pending status, open state and authenticated owner', async t => {
  let saved: any;
  t.mock.method(Need, 'create', async (payload: any) => { saved = payload; return payload; });
  await createNeed({ userId: actor, body: { title: 'Table', description: 'Study table', location: 'Pune', budget: 500, status: 'approved', userId: owner, isOpen: false } } as any, response() as any);
  assert.equal(saved.status, 'pending'); assert.equal(saved.userId, actor); assert.equal(saved.isOpen, true);
  await assert.rejects(createNeed({ body: { title: 'Table', description: 'Table', location: 'Pune', budget: -1 } } as any, response() as any), /budget/);
});
test('public needs show only approved open requests, escape location searches', async t => {
  let filter: any;
  t.mock.method(Need, 'aggregate', async (pipeline: any) => { filter = pipeline[0].$match; assert.equal(pipeline[2].$lookup.pipeline[0].$match.accountStatus, 'active'); return [{data:[],count:[]}]; });
  t.mock.method(Need, 'find', (query: any) => { filter = query; return chain([]); });
  t.mock.method(Need, 'countDocuments', async () => 0);
  await listNeeds({ userId: actor, query: { location: 'Pune.*' } } as any, response() as any);
  assert.equal(filter.status, 'approved'); assert.equal(filter.isOpen, true);
  assert.equal(filter.location.$regex, 'Pune\\.\\*');
  await listNeeds({ userId: actor, query: { mine: 'true', userId: owner } } as any, response() as any);
  assert.deepEqual(filter, { userId: actor });
});
test('only owner can close needs, reopening does not bypass moderation', async t => {
  let filter: any, update: any;
  t.mock.method(Need, 'findOneAndUpdate', async (query: any, changes: any) => { filter = query; update = changes; return {}; });
  await setNeedOpen({ userId: actor, params: { needId: target }, body: { isOpen: true, status: 'approved' } } as any, response() as any);
  assert.equal(filter.userId, actor); assert.deepEqual(update.$set, { isOpen: true });
});
test('need reviews require rejection feedback and reject stale edits', async t => {
  t.mock.method(Need, 'findOneAndUpdate', async () => null);
  const req = { params: { needId: target }, userId: actor, body: { status: 'rejected', updatedAt: new Date().toISOString(), reviewReason: '' } };
  await assert.rejects(reviewNeed(req as any, response() as any), /feedback/);
  req.body.reviewReason = 'Add more detail';
  await assert.rejects(reviewNeed(req as any, response() as any), /changed or was deleted/);
});
function availableListing(t: any, seller = owner) {
  t.mock.method(Listing, 'findOne', () => chain({ sellerId: oid(seller), title: 'Desk', categoryId: target, subcategoryId: target }));
  t.mock.method(Category, 'exists', async () => true);
  t.mock.method(Subcategory, 'exists', async () => true);
  t.mock.method(User, 'exists', async () => true);
}
test('contact recipient is taken from listing, never client supplied', async t => {
  availableListing(t);
  let saved: any, filter: any;
  t.mock.method(Conversation, 'findOneAndUpdate', async (query: any, changes: any) => { filter = query; saved = changes.$setOnInsert; return { _id: target }; });
  await startConversation({ userId: actor, body: { kind: 'listing', targetId: target, ownerId: actor, participants: [actor] } } as any, response() as any);
  assert.equal(saved.ownerId, owner); assert.deepEqual(saved.participants, [actor, owner]); assert.equal(filter.initiatorId, actor);
});
test('cannot contact yourself or start chats for pending needs', async t => {
  availableListing(t, actor);
  await assert.rejects(startConversation({ userId: actor, body: { kind: 'listing', targetId: target } } as any, response() as any), /yourself/);
  t.mock.method(Need, 'findOne', () => chain(null));
  await assert.rejects(startConversation({ userId: actor, body: { kind: 'need', targetId: target } } as any, response() as any), /closed or unavailable/);
});
test('providers contact the owner of an approved open need', async t => {
  let availability: any, saved: any;
  t.mock.method(Need, 'findOne', (query: any) => { availability = query; return chain({ userId: oid(owner), title: 'Need a table' }); });
  t.mock.method(User, 'exists', async () => true);
  t.mock.method(Conversation, 'findOneAndUpdate', async (_query: any, changes: any) => { saved = changes.$setOnInsert; return { _id: target }; });
  await startConversation({ userId: actor, body: { kind: 'need', targetId: target, ownerId: actor } } as any, response() as any);
  assert.deepEqual(availability, { _id: target, status: 'approved', isOpen: true });
  assert.equal(saved.ownerId, owner); assert.deepEqual(saved.participants, [actor, owner]);
});
test('nonparticipants cannot read or send conversation messages', async t => {
  let filter: any;
  t.mock.method(Conversation, 'findOne', (query: any) => { filter = query; return chain(null); });
  await assert.rejects(memberConversation(target, actor), /not found/);
  assert.deepEqual(filter, { _id: target, participants: actor });
  await assert.rejects(sendMessage({ userId: actor, params: { conversationId: target }, body: { text: 'Hello', clientId: 'client_123' } } as any, response() as any), /not found/);
});
test('messages use authenticated sender and idempotency reference', async t => {
  availableListing(t);
  t.mock.method(Conversation, 'findOne', () => chain({ _id: oid(target), kind: 'listing', targetId: oid(target), participants: [oid(actor), oid(owner)] }));
  let filter: any, saved: any;
  t.mock.method(Message, 'findOneAndUpdate', async (query: any, changes: any) => { filter = query; saved = changes.$setOnInsert; return { ...saved, createdAt: new Date() }; });
  t.mock.method(Conversation, 'updateOne', async () => ({}));
  await sendMessage({ userId: actor, params: { conversationId: target }, body: { text: ' Hello ', clientId: 'client_123', senderId: owner } } as any, response() as any);
  assert.equal(filter.senderId, actor); assert.equal(filter.clientId, 'client_123'); assert.equal(saved.text, 'Hello');
});
test('deactivated recipients cannot receive new messages', async t => {
  availableListing(t);
  t.mock.method(Conversation, 'findOne', () => chain({ _id: oid(target), kind: 'listing', targetId: oid(target), participants: [oid(actor), oid(owner)] }));
  t.mock.method(User, 'exists', async () => false);
  await assert.rejects(sendMessage({ userId: actor, params: { conversationId: target }, body: { text: 'Hello', clientId: 'client_123' } } as any, response() as any), /account is unavailable/);
});
test('message cursors are validated before querying messages', async t => {
  t.mock.method(Conversation, 'findOne', () => chain({ _id: target }));
  await assert.rejects(listMessages({ userId: actor, params: { conversationId: target }, query: { before: 'bad' } } as any, response() as any), /Invalid ID/);
});
test('admin cannot deactivate or delete own account', async () => {
  await assert.rejects(userStatus({ userId: actor, params: { userId: actor }, body: { accountStatus: 'blocked' } } as any, response() as any), /own account/);
  await assert.rejects(deleteUser({ userId: actor, params: { userId: actor }, body: {} } as any, response() as any), /own admin account/);
  await assert.rejects(userStatus({ userId: actor, params: { userId: actor.toUpperCase() }, body: { accountStatus: 'blocked' } } as any, response() as any), /own account/);
  await assert.rejects(deleteUser({ userId: actor, params: { userId: actor.toUpperCase() }, body: {} } as any, response() as any), /own admin account/);
});
test('deletion requires email confirmation and rejects admin targets before removing data', async t => {
  t.mock.method(mongoose.connection, 'transaction', async (fn: any) => fn({}));
  const user: any = { role: 'user', email: 'person@example.test' };
  t.mock.method(User, 'findById', () => ({ session: async () => user }));
  const req = { userId: actor, params: { userId: owner }, body: { confirmEmail: 'wrong' } };
  await assert.rejects(deleteUser(req as any, response() as any), /confirm permanent deletion/);
  user.role = 'admin';
  await assert.rejects(deleteUser(req as any, response() as any), /Remove admin access/);
});
test('account deletion cascades within one database transaction', async t => {
  t.mock.method(PushSubscription, 'deleteMany', async () => ({}));
  const session = {};
  const writes: any[] = [];
  t.mock.method(mongoose.connection, 'transaction', async (fn: any) => fn(session));
  t.mock.method(User, 'findById', () => ({ session: async () => ({ role: 'user', email: 'person@example.test' }) }));
  t.mock.method(Listing, 'find', () => chain([{ _id: target }]));
  t.mock.method(Conversation, 'find', () => chain([{ _id: target }]));
  for (const model of [Feedback, SupportMessage, Message, Conversation, Wishlist, Listing, Need, EmailOTP]) t.mock.method(model as any, 'deleteMany', async (filter: any, options: any) => { assert.equal(options.session, session); writes.push({ model: model.modelName, filter }); });
  for (const model of [Listing, Need]) t.mock.method(model as any, 'updateMany', async (_filter: any, _update: any, options: any) => { assert.equal(options.session, session); });
  t.mock.method(User, 'deleteOne', async (filter: any, options: any) => { assert.equal(options.session, session); assert.equal(filter._id, owner); });
  await deleteUser({ userId: actor, params: { userId: owner }, body: { confirmEmail: 'person@example.test' } } as any, response() as any);
  assert.equal(writes.length, 8);
  assert.equal(writes.find(write => write.model === 'Feedback').filter.userId, owner);
  assert.equal(writes.find(write => write.model === 'SupportMessage').filter.userId, owner);
  const wishlist = writes.find(write => write.model === 'Wishlist');
  assert.equal(wishlist.filter.$or[0].userId, owner);
  assert.deepEqual(wishlist.filter.$or[1].listingId.$in, [target]);
});

test('community HTTP routes reject anonymous users, admin APIs reject ordinary and blocked accounts', async t => {
  const secret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'community-test-only';
  let blocked = false;
  t.mock.method(User, 'findById', () => ({ select: async () => ({ _id: oid(actor), role: 'user', accountStatus: blocked ? 'blocked' : 'active' }) }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const token = jwt.sign({ userId: actor, purpose: 'access' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    for (const path of ['/support/messages', '/wishlist', '/needs', '/conversations', `/conversations/${target}/messages`]) assert.equal((await fetch(`${base}${path}`)).status, 401);
    for (const path of ['/admin/feedback', '/admin/banners', '/admin/support', '/admin/support/' + actor + '/messages', '/admin/wishlists', '/admin/needs', `/admin/users/${owner}`]) assert.equal((await fetch(`${base}${path}`, { headers })).status, 403);
    for (const [path, method] of [[`/admin/needs/${target}/review`, 'PATCH'], [`/admin/users/${owner}/status`, 'PATCH'], [`/admin/users/${owner}`, 'DELETE']]) assert.equal((await fetch(`${base}${path}`, { method, headers, body: '{}' })).status, 403);
    blocked = true;
    assert.equal((await fetch(`${base}/wishlist`, { headers })).status, 401);
    assert.equal((await fetch(`${base}/conversations`, { method: 'POST', headers, body: '{}' })).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
  }
});
