import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { adminBanners, createBanner, deleteBanner, publicBanners, signBannerUpload, updateBanner } from '../src/controllers/banner.controller';
import Banner from '../src/models/Banner';

const id = '507f1f77bcf86cd799439011';
const publicId = 'bechde/banners/12345678-1234-1234-1234-123456789abc';
function response() { return { body: null as any, code: 200, status(value: number) { this.code = value; return this; }, json(value: unknown) { this.body = value; return this; } }; }
test('banner signatures restrict file formats and keep the Cloudinary secret private', () => {
  const original = { name: process.env.CLOUDINARY_CLOUD_NAME, key: process.env.CLOUDINARY_API_KEY, secret: process.env.CLOUDINARY_API_SECRET };
  process.env.CLOUDINARY_CLOUD_NAME = 'cloud'; process.env.CLOUDINARY_API_KEY = 'key'; process.env.CLOUDINARY_API_SECRET = 'private';
  try {
    for (const kind of ['image', 'video']) {
      const res = response(); signBannerUpload({ body: { kind } } as any, res as any);
      assert.equal(res.body.resourceType, kind); assert.equal(res.body.params.overwrite, 'false');
      assert.match(res.body.params.public_id, /^bechde\/banners\//);
      assert.equal(res.body.params.allowed_formats, kind === 'image' ? 'jpg,jpeg,png,webp,gif' : 'mp4');
      const canonical = Object.entries(res.body.params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
      assert.equal(res.body.signature, crypto.createHash('sha1').update(canonical + 'private').digest('hex'));
      assert.equal(res.body.secret, undefined);
    }
    assert.throws(() => signBannerUpload({ body: { kind: 'html' } } as any, response() as any), /image or video/);
  } finally {
    for (const [key, value] of Object.entries({ CLOUDINARY_CLOUD_NAME: original.name, CLOUDINARY_API_KEY: original.key, CLOUDINARY_API_SECRET: original.secret })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
test('banner publishing verifies Cloudinary media and ignores client-supplied URLs', async t => {
  const originals = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].map(key => [key, process.env[key]] as const);
  process.env.CLOUDINARY_CLOUD_NAME = 'cloud'; process.env.CLOUDINARY_API_KEY = 'key'; process.env.CLOUDINARY_API_SECRET = 'private';
  const asset = { public_id: publicId, resource_type: 'image', format: 'jpg', bytes: 5000, secure_url: 'https://res.cloudinary.com/cloud/image/upload/banner.jpg' };
  t.mock.method(globalThis, 'fetch', async (url: any) => { assert.match(String(url), /\/resources\/image\/upload\/bechde%2Fbanners%2F/); return { ok: true, json: async () => asset } as any; });
  let saved: any;
  t.mock.method(Banner, 'create', async (value: any) => { saved = value; return value; });
  const body = { title: ' Home banner ', kind: 'image', publicId, url: 'https://untrusted.test/image.jpg', sortOrder: 2 };
  try {
    const res = response(); await createBanner({ body } as any, res as any);
    assert.equal(res.code, 201); assert.equal(saved.url, asset.secure_url); assert.equal(saved.title, 'Home banner'); assert.equal(saved.isActive, true);
    asset.format = 'gif'; asset.secure_url = 'https://res.cloudinary.com/cloud/image/upload/banner.gif';
    await createBanner({ body } as any, response() as any);
    assert.equal(saved.url, asset.secure_url); assert.equal(saved.kind, 'image');
    asset.bytes = 11 * 1024 * 1024;
    await assert.rejects(() => createBanner({ body } as any, response() as any), /up to 10 MB/);
    asset.bytes = 5000; asset.resource_type = 'video';
    await assert.rejects(() => createBanner({ body } as any, response() as any), /up to 10 MB/);
    await assert.rejects(() => createBanner({ body: { ...body, publicId: 'another/folder' } } as any, response() as any), /Upload banner media/);
    await assert.rejects(() => createBanner({ body: { ...body, isActive: 'yes' } } as any, response() as any), /active/);
    await assert.rejects(() => createBanner({ body: { ...body, sortOrder: -1 } } as any, response() as any), /whole number/);
  } finally { for (const [key, value] of originals) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test('home feed includes only active banners in a stable order and admin operations validate IDs', async t => {
  let filter: any; let sort: any; let limit: any;
  t.mock.method(Banner, 'find', (value: any) => {
    filter = value; const query: any = { sort: (value: any) => { sort = value; return query; }, limit: (value: any) => { limit = value; return query; }, select: () => query, skip: () => query, lean: async () => [] }; return query;
  });
  t.mock.method(Banner, 'countDocuments', async () => 21);
  await publicBanners({} as any, response() as any);
  assert.deepEqual(filter, { isActive: true }); assert.deepEqual(sort, { sortOrder: 1, _id: 1 }); assert.equal(limit, 20);
  const res = response(); await adminBanners({ query: { page: '2' } } as any, res as any); assert.equal(res.body.pages, 2);
  let patch: any;
  t.mock.method(Banner, 'findByIdAndUpdate', async (_id: any, value: any) => { patch = value; return { _id: id }; });
  await updateBanner({ params: { bannerId: id }, body: { isActive: false, sortOrder: 3, url: 'javascript:bad' } } as any, response() as any);
  assert.deepEqual(patch, { $set: { isActive: false, sortOrder: 3 } });
  await assert.rejects(() => updateBanner({ params: { bannerId: id }, body: { kind: 'video' } } as any, response() as any), /replacement media/);
  await assert.rejects(() => deleteBanner({ params: { bannerId: 'bad' } } as any, response() as any), /Invalid ID/);
  t.mock.method(Banner, 'findByIdAndDelete', async () => null);
  await assert.rejects(() => deleteBanner({ params: { bannerId: id } } as any, response() as any), /not found/);
});
