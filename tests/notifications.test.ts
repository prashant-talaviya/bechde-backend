import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import User from '../src/models/User';
import EmailOTP from '../src/models/EmailOTP';
import PushSubscription from '../src/models/PushSubscription';
import NotificationCampaign from '../src/models/NotificationCampaign';
import { bindPushSubscription, pushPayloadSchema } from '../src/services/push-subscriptions';
import { sendPromotionalPush } from '../src/services/onesignal';
import { processNotificationBatch } from '../src/services/notification-worker';
import { createNotificationCampaign, promotionSchema } from '../src/controllers/notification.controller';
import { verifyEmailOTP, completeRegistration } from '../src/controllers/auth.controller';
import { hashOTP } from '../src/utils/auth';

const actor = '507f1f77bcf86cd799439011';
const other = '507f1f77bcf86cd799439012';
const subscriptionId = 'd46028aa-106c-4cd8-99ad-f337f1896775';
const payload = { onesignal_subscription_id: subscriptionId, onesignal_push_opted_in: true, push_platform: 'android' as const };
function response() { return { code: 200, body: null as any, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } }; }
function chain(data: any) { return { select: () => chain(data), lean: async () => data }; }
function environment(t: any) {
  const previous = { key: process.env.ONESIGNAL_REST_API_KEY, secret: process.env.JWT_SECRET, otp: process.env.OTP_SECRET };
  process.env.ONESIGNAL_REST_API_KEY = 'test-server-key'; process.env.JWT_SECRET = 'test-notification-secret';
  process.env.OTP_SECRET = 'test-otp-secret';
  t.after(() => {
    if (previous.key === undefined) delete process.env.ONESIGNAL_REST_API_KEY; else process.env.ONESIGNAL_REST_API_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous.secret;
    if (previous.otp === undefined) delete process.env.OTP_SECRET; else process.env.OTP_SECRET = previous.otp;
  });
}

test('subscription payload accepts pending IDs without treating them as opted in', () => {
  assert.equal(pushPayloadSchema.parse({ onesignal_subscription_id: null }).onesignal_push_opted_in, false);
  assert.equal(pushPayloadSchema.safeParse({ onesignal_subscription_id: 'invalid' }).success, false);
  assert.equal(pushPayloadSchema.safeParse({ ...payload, onesignal_push_opted_in: 'true' }).success, false);
});

test('subscription binding reassigns a device without replacing the users other devices', async t => {
  const writes: any[] = [];
  t.mock.method(PushSubscription, 'findOneAndUpdate', async (...args: any[]) => { writes.push(args); return {}; });
  t.mock.method(User, 'updateMany', async (filter: any) => { assert.equal(filter._id.$ne, actor); return {}; });
  t.mock.method(User, 'updateOne', async (filter: any, update: any) => { assert.equal(filter._id, actor); assert.equal(update.$set.onesignal_subscription_id, subscriptionId); return {}; });
  await bindPushSubscription(actor, payload);
  assert.deepEqual(writes[0][0], { subscriptionId });
  assert.equal(writes[0][1].$set.userId, actor);
  assert.equal(writes[0][2].upsert, true);
});

test('verified login persists subscription from its payload and returns its ID', async t => {
  environment(t);
  t.mock.method(EmailOTP, 'findOne', async () => ({ expiresAt: new Date(Date.now() + 60000), attempts: 0, codeHash: hashOTP('1234') }));
  t.mock.method(EmailOTP, 'deleteOne', async () => ({}));
  t.mock.method(User, 'findOne', async () => ({ _id: actor, name: 'User', mobile: '9876543210', accountStatus: 'active' }));
  let bound = false;
  t.mock.method(PushSubscription, 'findOneAndUpdate', async (_filter: any, update: any) => { bound = update.$set.userId === actor; return {}; });
  t.mock.method(User, 'updateMany', async () => ({}));
  t.mock.method(User, 'updateOne', async () => ({}));
  const res = response();
  await verifyEmailOTP({ body: { email: 'person@example.test', otp: '1234', ...payload } } as any, res as any);
  assert.equal(res.code, 200); assert.ok(res.body.token); assert.equal(bound, true); assert.equal(res.body.user.onesignal_subscription_id, subscriptionId);
});

test('signup saves a silent subscription after the email and profile are verified', async t => {
  environment(t);
  t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User, 'create', async (record: any) => ({ ...record, _id: actor }));
  let bound = false;
  t.mock.method(PushSubscription, 'findOneAndUpdate', async (_filter: any, update: any) => { bound = update.$set.userId === actor && update.$set.optedIn === false; return {}; });
  t.mock.method(User, 'updateMany', async () => ({})); t.mock.method(User, 'updateOne', async () => ({}));
  const token = jwt.sign({ email: 'person@example.test', purpose: 'registration' }, process.env.JWT_SECRET!);
  const res = response();
  await completeRegistration({ headers: { authorization: `Bearer ${token}` }, body: { name: 'Test User', mobile: '9876543210', agreedToPolicies: true, ...payload, onesignal_push_opted_in: false } } as any, res as any);
  assert.equal(res.code, 201); assert.equal(bound, true); assert.equal(res.body.user.onesignal_subscription_id, subscriptionId);
});

test('OneSignal sends one alias audience, a stable retry key, and a server-only API key', async t => {
  environment(t);
  const key = randomUUID();
  t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
    assert.equal(url, 'https://api.onesignal.com/notifications?c=push');
    assert.equal(options.headers.Authorization, 'Key test-server-key');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.include_aliases, { external_id: [actor] });
    assert.equal(body.app_id, 'e7f5b065-7a1e-4479-b8e3-c233d1ae4cc0');
    assert.equal(body.idempotency_key, key); assert.equal(body.included_segments, undefined);
    return { ok: true, json: async () => ({ id: 'notification-id' }) } as any;
  });
  assert.equal(await sendPromotionalPush({ title: 'Offer', body: 'Sale', screen: 'home', externalIds: [actor], idempotencyKey: key }), 'notification-id');
});

test('OneSignal rejects a success response with no reachable subscribers', async t => {
  environment(t);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ id: '', errors: ['No subscribers'] }) }) as any);
  await assert.rejects(() => sendPromotionalPush({ title: 'Offer', body: 'Sale', screen: 'home', externalIds: [actor], idempotencyKey: randomUUID() }), /no reachable/);
});

test('campaign retries reuse the queued reference and do not create another campaign', async t => {
  environment(t);
  const requestId = randomUUID();
  const body = { requestId, title: 'Offer', body: 'Sale', screen: 'home', audience: 'all', userIds: [] };
  let fingerprint = '';
  let created = 0;
  t.mock.method(NotificationCampaign, 'findOne', () => chain(fingerprint ? { _id: other, fingerprint } : null));
  t.mock.method(NotificationCampaign, 'create', async (record: any) => { fingerprint = record.fingerprint; created++; return record; });
  t.mock.method(PushSubscription, 'distinct', async () => [actor]);
  t.mock.method(User, 'find', (query: any) => { assert.equal(query.accountStatus, 'active'); return chain([{ _id: actor }]) as any; });
  await createNotificationCampaign({ userId: actor, body } as any, response() as any);
  await createNotificationCampaign({ userId: actor, body } as any, response() as any);
  assert.equal(created, 1);
  await assert.rejects(() => createNotificationCampaign({ userId: actor, body: { ...body, title: 'Different' } } as any, response() as any), /another notification/);
  assert.equal(promotionSchema.safeParse({ ...body, audience: 'users', userIds: [] }).success, false);
});

test('worker keeps a failed batch at its cursor for safe retry with the original key', async t => {
  environment(t);
  const batchKey = randomUUID();
  t.mock.method(NotificationCampaign, 'findOneAndUpdate', () => chain({ _id: other, title: 'Sale', body: 'Hello', screen: 'home', cursor: 0, total: 1, recipients: [actor], batchKeys: [batchKey] }) as any);
  t.mock.method(PushSubscription, 'distinct', async () => [actor]);
  t.mock.method(User, 'find', () => chain([{ _id: actor }]) as any);
  let update: any;
  t.mock.method(NotificationCampaign, 'updateOne', async (_query: any, changes: any) => { update = changes; return {}; });
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => { assert.equal(JSON.parse(options.body).idempotency_key, batchKey); throw new Error('Connection interrupted'); });
  await processNotificationBatch();
  assert.equal(update.$set.status, 'failed'); assert.equal(update.$set.cursor, undefined);
});

test('worker advances only its leased batch and rechecks active recipient accounts', async t => {
  environment(t);
  const batchKey = randomUUID();
  t.mock.method(NotificationCampaign, 'findOneAndUpdate', (_filter: any, claim: any) => {
    assert.ok(claim.$set.leaseToken);
    return chain({ _id: other, title: 'Sale', body: 'Hello', screen: 'home', cursor: 0, total: 2, recipients: [actor, other], batchKeys: [batchKey] }) as any;
  });
  t.mock.method(PushSubscription, 'distinct', async (_field: string, filter: any) => { assert.equal(filter.optedIn, true); return [actor, other]; });
  t.mock.method(User, 'find', (filter: any) => { assert.equal(filter.accountStatus, 'active'); return chain([{ _id: actor }]) as any; });
  let update: any;
  t.mock.method(NotificationCampaign, 'updateOne', async (filter: any, changes: any) => { assert.ok(filter.leaseToken); update = changes; return {}; });
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
    assert.deepEqual(JSON.parse(options.body).include_aliases.external_id, [actor]);
    return { ok: true, json: async () => ({ id: 'accepted-id' }) } as any;
  });
  await processNotificationBatch();
  assert.equal(update.$set.cursor, 2); assert.equal(update.$set.status, 'submitted'); assert.equal(update.$inc.submitted, 1);
});

test('worker does not replay a send after the provider idempotency window', async t => {
  environment(t);
  t.mock.method(NotificationCampaign, 'findOneAndUpdate', () => chain({ _id: other, createdAt: new Date(Date.now() - 31 * 86400000) }) as any);
  let status = '';
  t.mock.method(NotificationCampaign, 'updateOne', async (_filter: any, update: any) => { status = update.$set.status; assert.match(update.$set.error, /too old/); return {}; });
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('An expired campaign must not be sent again.'); });
  await processNotificationBatch();
  assert.equal(status, 'failed');
});

test('logout removes only the authenticated accounts current device subscription', async t => {
  environment(t);
  t.mock.method(User, 'findById', () => ({ select: async () => ({ _id: actor, role: 'user', accountStatus: 'active' }) }) as any);
  t.mock.method(PushSubscription, 'deleteOne', async (filter: any) => { assert.equal(filter.userId, actor); assert.equal(filter.subscriptionId, subscriptionId); return {}; });
  t.mock.method(User, 'updateOne', async (filter: any) => { assert.equal(filter._id, actor); assert.equal(filter.onesignal_subscription_id, subscriptionId); return {}; });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const token = jwt.sign({ userId: actor, purpose: 'access' }, process.env.JWT_SECRET!);
    const res = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/auth/push-subscription`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, userId: other }) });
    assert.equal(res.status, 200);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('notification admin endpoints reject ordinary users and anonymous sends', async t => {
  environment(t);
  t.mock.method(User, 'findById', () => ({ select: async () => ({ _id: actor, role: 'user', accountStatus: 'active' }) }) as any);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/admin/notifications`;
  try {
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    const token = jwt.sign({ userId: actor, purpose: 'access' }, process.env.JWT_SECRET!);
    assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
