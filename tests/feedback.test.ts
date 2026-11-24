import test from 'node:test';
import assert from 'node:assert/strict';
import { adminFeedback, submitFeedback } from '../src/controllers/feedback.controller';
import Feedback from '../src/models/Feedback';

const actor = '507f1f77bcf86cd799439011';
function response() { return { body: null as any, json(body: unknown) { this.body = body; return this; } }; }
test('feedback derives ownership from authentication and retries do not create duplicates', async t => {
  let saved: any;
  t.mock.method(Feedback, 'create', async (value: any) => { saved = { ...value, _id: actor }; return saved; });
  const req: any = { userId: actor, body: { userId: 'spoofed', message: ' Please improve search ', rating: 4, clientId: 'submission-1' } };
  const res = response(); await submitFeedback(req, res as any);
  assert.equal(saved.rating, 4); assert.equal(saved.userId, actor); assert.equal(saved.message, 'Please improve search');
  assert.deepEqual(res.body.data, { _id: actor });
  t.mock.method(Feedback, 'create', async () => { throw { code: 11000 }; });
  t.mock.method(Feedback, 'findOne', async (key: any) => { assert.deepEqual(key, { userId: actor, clientId: 'submission-1' }); return saved; });
  await submitFeedback(req, response() as any);
  await assert.rejects(() => submitFeedback({ ...req, body: { ...req.body, rating: 5 } }, response() as any), /already used/);
  await assert.rejects(() => submitFeedback({ ...req, body: { ...req.body, message: 'Different feedback' } }, response() as any), /already used/);
});
test('feedback validates message length, submission identity and authenticated owner', async () => {
  for (const message of ['', '   ', 'x'.repeat(2001), null]) {
    await assert.rejects(() => submitFeedback({ userId: actor, body: { message, clientId: 'test' } } as any, response() as any), /Feedback is required/);
  }
  for (const rating of [0, 6, 1.5, '5', true]) {
    await assert.rejects(() => submitFeedback({ userId: actor, body: { message: 'Hello', clientId: 'test', rating } } as any, response() as any), /rating from 1 to 5/);
  }
  await assert.rejects(() => submitFeedback({ userId: actor, body: { message: 'Hello' } } as any, response() as any), /Submission identifier/);
  await assert.rejects(() => submitFeedback({ body: { message: 'Hello', clientId: 'test' } } as any, response() as any), /Invalid ID/);
});
test('admin feedback is protected, paginated and exposes only limited account fields', async t => {
  await assert.rejects(() => adminFeedback({ userRole: 'user', query: {} } as any, response() as any), /Admin access/);
  const captured: any = {};
  t.mock.method(Feedback, 'find', () => {
    const query: any = {};
    for (const name of ['sort', 'skip', 'limit', 'select', 'populate']) query[name] = (...args: any[]) => { captured[name] = args; return query; };
    query.lean = async () => [{ _id: actor, message: 'Feedback' }]; return query;
  });
  t.mock.method(Feedback, 'countDocuments', async () => 21);
  const res = response(); await adminFeedback({ userRole: 'admin', query: { page: '2' } } as any, res as any);
  assert.deepEqual(captured.skip, [20]); assert.deepEqual(captured.limit, [20]);
  assert.deepEqual(captured.select, ['userId message rating createdAt']);
  assert.deepEqual(captured.populate, ['userId', 'name email']);
  assert.deepEqual(captured.sort, [{ createdAt: -1, _id: -1 }]);
  assert.equal(res.body.total, 21); assert.equal(res.body.pages, 2);
});
