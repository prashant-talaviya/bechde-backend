import test from 'node:test';
import assert from 'node:assert/strict';
import { supportMessages, sendSupportMessage, adminSupportMessages, adminSendSupportMessage, supportInbox } from '../src/controllers/support.controller';
import SupportMessage from '../src/models/SupportMessage';
import User from '../src/models/User';

const user = '507f1f77bcf86cd799439011';
const other = '507f1f77bcf86cd799439012';
const id = '507f1f77bcf86cd799439013';
function response() { return { body: null as any, json(value: unknown) { this.body = value; return this; } }; }
function chain(value: unknown) {
  const query: any = {};
  for (const method of ['sort', 'limit', 'select']) query[method] = () => query;
  query.lean = async () => value;
  return query;
}
test('member message history uses authenticated ownership and marks only returned incoming messages', async () => {
  const original = { find: SupportMessage.find, update: SupportMessage.updateMany };
  let filter: any; let readFilter: any;
  (SupportMessage as any).find = (value: any) => { filter = value; return chain(Array.from({ length: 41 }, (_, i) => ({ _id: String(i), text: 'hello' }))); };
  (SupportMessage as any).updateMany = async (value: any) => { readFilter = value; };
  try {
    const res = response();
    await supportMessages({ userId: user, params: { userId: other }, query: { before: id } } as any, res as any);
    assert.equal(filter.userId, user);
    assert.deepEqual(filter._id, { $lt: id });
    assert.equal(res.body.data.length, 40); assert.equal(res.body.hasMore, true);
    assert.equal(readFilter.fromSupport, true); assert.equal(readFilter._id.$in.length, 40);
    await adminSupportMessages({ userId: other, userRole: 'admin', params: { userId: user }, query: {} } as any, response() as any);
    assert.equal(filter.userId, user); assert.equal(readFilter.fromSupport, false);
    await assert.rejects(() => adminSupportMessages({ userId: other, userRole: 'user', params: { userId: user }, query: {} } as any, response() as any), /Admin access/);
    await assert.rejects(() => supportMessages({ userId: user, query: { before: 'bad' } } as any, response() as any), /Invalid ID/);
  } finally { SupportMessage.find = original.find; SupportMessage.updateMany = original.update; }
});
test('support sends validate text, ignore spoofed identity, and make retries idempotent', async () => {
  const original = { create: SupportMessage.create, find: SupportMessage.findOne, exists: User.exists };
  let saved: any;
  (SupportMessage as any).create = async (value: any) => { saved = { ...value, _id: id, createdAt: new Date() }; return saved; };
  (User as any).exists = async () => ({ _id: user });
  const req: any = { userId: user, params: { userId: other }, body: { text: ' Help ', clientId: 'retry-1', userId: other, fromSupport: true } };
  try {
    const res = response(); await sendSupportMessage(req, res as any);
    assert.equal(saved.userId, user); assert.equal(saved.senderId, user); assert.equal(saved.fromSupport, false); assert.equal(saved.text, 'Help');
    assert.equal(res.body.data.senderId, undefined); // Do not expose admin identities to members.
    (SupportMessage as any).create = async () => { throw { code: 11000 }; };
    (SupportMessage as any).findOne = async (key: any) => { assert.equal(key.userId, user); assert.equal(key.senderId, user); return saved; };
    await sendSupportMessage(req, response() as any);
    await assert.rejects(() => sendSupportMessage({ ...req, body: { ...req.body, text: 'Different' } }, response() as any), /already used/);
    for (const text of ['', ' '.repeat(3), 'x'.repeat(2001)]) await assert.rejects(() => sendSupportMessage({ ...req, body: { ...req.body, text } }, response() as any), /Message is required/);
    await assert.rejects(() => adminSendSupportMessage({ ...req, userRole: 'user' }, response() as any), /Admin access/);
    (SupportMessage as any).create = async (value: any) => { saved = value; return { ...value, _id: id }; };
    await adminSendSupportMessage({ ...req, userRole: 'admin' }, response() as any);
    assert.equal(saved.userId, other); assert.equal(saved.fromSupport, true);
    (User as any).exists = async () => null;
    await assert.rejects(() => adminSendSupportMessage({ ...req, userRole: 'admin' }, response() as any), /Active user not found/);
  } finally { SupportMessage.create = original.create; SupportMessage.findOne = original.find; User.exists = original.exists; }
});
test('support inbox requires admin access and paginates before exposing customer details', async () => {
  const original = SupportMessage.aggregate;
  let pipeline: any;
  (SupportMessage as any).aggregate = async (value: any) => { pipeline = value; return [{ count: [{ total: 21 }], data: [{ _id: user, unread: 2 }] }]; };
  try {
    await assert.rejects(() => supportInbox({ userRole: 'user', query: {} } as any, response() as any), /Admin access/);
    const res = response(); await supportInbox({ userRole: 'admin', query: { page: '2' } } as any, res as any);
    assert.equal(res.body.pages, 2); assert.equal(res.body.data[0].unread, 2);
    const data = pipeline.find((stage: any) => stage.$facet).$facet.data;
    assert.deepEqual(data[0], { $skip: 20 }); assert.deepEqual(data[1], { $limit: 20 });
    assert.deepEqual(data[2].$lookup.pipeline[0].$project, { name: 1, email: 1, accountStatus: 1 });
  } finally { SupportMessage.aggregate = original; }
});
