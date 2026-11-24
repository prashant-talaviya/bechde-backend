import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import User from '../src/models/User';
import app from '../src/app';
import Listing from '../src/models/Listing';
import Category from '../src/models/Category';
import Wishlist from '../src/models/Wishlist';
import { decodeListingCursor, listPublicListings } from '../src/controllers/listing-feed.controller';
import { wishlistStates } from '../src/controllers/wishlist.controller';

const id = '507f1f77bcf86cd799439011';
const stamp = '2026-11-05T10:00:00.000Z';
const row = (offset: number) => ({ _id: new mongoose.Types.ObjectId((BigInt('0x' + id) - BigInt(offset)).toString(16)), title: 'Phone', createdAt: new Date(stamp) });
function response() { return { body: null as any, json(body: unknown) { this.body = body; return this; } }; }
async function load(query: object) {
  const res = response();
  await listPublicListings({ query } as any, res as any, error => { throw error; });
  return res.body;
}

test('feed is bounded, sends card fields only, and excludes unavailable owners/taxonomy before the page limit', async t => {
  let pipeline: any[] = [];
  t.mock.method(Listing, 'aggregate', async (stages: any) => { pipeline = stages; return Array.from({ length: 13 }, (_, index) => row(index)); });
  const result = await load({});
  assert.equal(result.data.length, 12); assert.equal(result.hasMore, true);
  assert.deepEqual(pipeline[0].$match, { status: 'approved' });
  assert.deepEqual(pipeline[1].$sort, { createdAt: -1, _id: -1 });
  assert.equal(pipeline[2].$project.description, undefined); assert.equal(pipeline[2].$project.media, undefined);
  assert.equal(pipeline[2].$project['attributes.condition'], 1);
  const limitIndex = pipeline.findIndex(stage => stage.$limit);
  assert.equal(pipeline[limitIndex].$limit, 13);
  assert.ok(pipeline.findIndex(stage => stage.$match?.['seller.0']) < limitIndex);
  assert.equal(pipeline.filter(stage => stage.$lookup).length, 3);
  assert.ok(pipeline.filter(stage => stage.$lookup).every(stage => stage.$lookup.pipeline[0].$match));
  const decoded = decodeListingCursor(result.nextCursor)!;
  assert.equal(String(decoded._id), String(row(11)._id)); assert.equal(decoded.createdAt.toISOString(), stamp);
});

test('cursor handles same-date rows and search/category filters apply to every database page', async t => {
  let pipeline: any[] = [];
  t.mock.method(Category, 'findOne', () => ({ select: () => ({ lean: async () => ({ _id: new mongoose.Types.ObjectId(id) }) }) }));
  t.mock.method(Listing, 'aggregate', async (stages: any) => { pipeline = stages; return []; });
  const cursor = Buffer.from(JSON.stringify({ createdAt: stamp, id })).toString('base64url');
  const result = await load({ category: 'phones', q: 'Phone.*', cursor, limit: '1000' });
  const filter = pipeline[0].$match;
  assert.equal(String(filter.categoryId), id);
  assert.equal(filter.$and[0].$or[0].title.$regex, 'Phone\\.\\*');
  assert.equal(filter.$and[1].$or[0].createdAt.$lt.toISOString(), stamp);
  assert.equal(filter.$and[1].$or[1].createdAt.toISOString(), stamp);
  assert.equal(String(filter.$and[1].$or[1]._id.$lt), id);
  assert.equal(pipeline.find(stage => stage.$limit).$limit, 25);
  assert.equal(result.hasMore, false); assert.equal(result.nextCursor, null);
});

test('bad cursors and limits fail before a database request; unknown categories finish pagination', async t => {
  t.mock.method(Listing, 'aggregate', () => { throw new Error('Database must not be queried'); });
  for (const cursor of ['not-json', '!', Buffer.from(JSON.stringify({ createdAt: 'bad', id })).toString('base64url')]) await assert.rejects(load({ cursor }), /Invalid listing cursor/);
  for (const limit of ['0', '-2', '1.5', 'NaN']) await assert.rejects(load({ limit }), /Invalid listing limit/);
  t.mock.method(Category, 'findOne', () => ({ select: () => ({ lean: async () => null }) }));
  assert.deepEqual(await load({ category: 'removed' }), { success: true, data: [], hasMore: false, nextCursor: null });
});

test('wishlist batch statuses are bounded and scoped to the authenticated account', async t => {
  let filter: any;
  const other = '507f1f77bcf86cd799439012';
  t.mock.method(Wishlist, 'find', (query: any) => { filter = query; return { select: () => ({ lean: async () => [{ _id: id, listingId: other }] }) }; });
  const res = response();
  await wishlistStates({ userId: id, query: { ids: `${id},${other}` } } as any, res as any);
  assert.equal(filter.userId, id); assert.deepEqual(filter.listingId.$in, [id, other]);
  assert.deepEqual(res.body.data[id], { saved: false, entryId: null });
  assert.deepEqual(res.body.data[other], { saved: true, entryId: id });
  await assert.rejects(wishlistStates({ userId: id, query: { ids: Array(25).fill(id).join(',') } } as any, response() as any), /24 listings/);
  await assert.rejects(wishlistStates({ userId: id, query: { ids: 'bad-id' } } as any, response() as any), /Invalid ID/);
});

test('authenticated feed hides only the current seller before pagination, including search and category pages', async t => {
  let pipeline: any[] = [];
  t.mock.method(Listing, 'aggregate', async (stages: any) => { pipeline = stages; return []; });
  t.mock.method(Category, 'findOne', () => ({ select: () => ({ lean: async () => ({ _id: new mongoose.Types.ObjectId(id) }) }) }));
  const cursor = Buffer.from(JSON.stringify({ createdAt: stamp, id })).toString('base64url');
  for (const query of [{}, { q: 'Phone' }, { category: 'phones', cursor, sellerId: 'forged-user' }]) {
    const res = { ...response(), set(name: string, value: string) { assert.equal(name, 'Cache-Control'); assert.equal(value, 'private, no-store'); return this; } };
    await listPublicListings({ query, userId: id } as any, res as any, error => { throw error; });
    assert.equal(String(pipeline[0].$match.sellerId.$ne), id);
    assert.ok(pipeline.findIndex(stage => stage.$limit) > 0);
  }
  await load({ sellerId: id });
  assert.equal(pipeline[0].$match.sellerId, undefined, 'Anonymous callers cannot choose an account to filter on behalf of');
});

test('feed route verifies the session before filtering out the viewer and rejects invalid credentials', async t => {
  const savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'feed-auth-test-only';
  let calls = 0;
  let match: any;
  t.mock.method(User, 'findById', () => ({ select: async () => ({ _id: id, accountStatus: 'active', role: 'user' }) }));
  t.mock.method(Listing, 'aggregate', async (stages: any) => { calls++; match = stages[0].$match; return []; });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const token = jwt.sign({ userId: id, purpose: 'access' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const result = await fetch(`http://127.0.0.1:${port}/api/listings?sellerId=forged`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(result.status, 200); assert.equal(String(match.sellerId.$ne), id);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    const invalid = await fetch(`http://127.0.0.1:${port}/api/listings`, { headers: { Authorization: 'Bearer invalid' } });
    assert.equal(invalid.status, 401); assert.equal(calls, 1);
    const anonymous = await fetch(`http://127.0.0.1:${port}/api/listings`);
    assert.equal(anonymous.status, 200); assert.equal(match.sellerId, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (savedSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = savedSecret;
  }
});
