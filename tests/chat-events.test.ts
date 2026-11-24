import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import User from '../src/models/User';
import { attachChatEvents, notifyUnreadChanged } from '../src/services/chat-events';

const actor = '507f1f77bcf86cd799439011';
const other = '507f1f77bcf86cd799439012';
async function setup(t: any) {
  const secret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'realtime-test-secret';
  t.mock.method(User, 'findById', (id: string) => ({ select: () => ({ maxTimeMS: () => ({ lean: async () => ({ _id: id, accountStatus: 'active' }) }) }) }) as any);
  const server = createServer((_req, res) => res.end('ok'));
  const wss = attachChatEvents(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/api/events`;
  t.after(async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
  });
  return { url };
}
async function connect(url: string, userId: string, expiresIn = 60) {
  const token = jwt.sign({ userId, purpose: 'access' }, process.env.JWT_SECRET!, { expiresIn });
  const client = new WebSocket(url, ['bechde.events', `auth.${token}`]);
  const events: string[] = [];
  await new Promise<void>((resolve, reject) => {
    client.on('error', reject);
    client.on('message', value => { const event = JSON.parse(String(value)); events.push(event.type); if (event.type === 'ready') resolve(); });
  });
  return { client, events };
}

test('live unread events reach only the authenticated user and all of their devices', async t => {
  const { url } = await setup(t);
  const a = await connect(url, actor);
  const a2 = await connect(url, actor);
  const b = await connect(url, other);
  const received = Promise.all([once(a.client, 'message'), once(a2.client, 'message')]);
  notifyUnreadChanged(actor);
  await received;
  assert.deepEqual(a.events, ['ready', 'unread.changed']);
  assert.deepEqual(a2.events, ['ready', 'unread.changed']);
  assert.deepEqual(b.events, ['ready']);
  a.client.terminate(); a2.client.terminate(); b.client.terminate();
});

test('unauthenticated upgrades cannot subscribe to chat events', async t => {
  const { url } = await setup(t);
  const client = new WebSocket(url, ['bechde.events', 'auth.invalid']);
  await new Promise<void>((resolve, reject) => {
    client.on('unexpected-response', (_request, response) => { assert.equal(response.statusCode, 401); response.resume(); client.terminate(); resolve(); });
    client.on('open', () => reject(new Error('Unauthorized socket opened')));
    client.on('error', () => {});
  });
});

test('socket closes when its access token expires', async t => {
  const { url } = await setup(t);
  const { client } = await connect(url, actor, 1);
  const [code] = await once(client, 'close');
  assert.equal(code, 4001);
});
