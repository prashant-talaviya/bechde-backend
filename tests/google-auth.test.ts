import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import User from '../src/models/User';
import { verifyGoogle } from '../src/controllers/auth.controller';

function response() { return { code: 200, body: null as any, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } }; }
function setup(t: any, identity: any) {
  const previous = { client: process.env.GOOGLE_WEB_CLIENT_ID, secret: process.env.JWT_SECRET };
  process.env.GOOGLE_WEB_CLIENT_ID = 'test-client'; process.env.JWT_SECRET = 'google-test-secret';
  t.after(() => { for (const [key, value] of Object.entries({ GOOGLE_WEB_CLIENT_ID: previous.client, JWT_SECRET: previous.secret })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async (options: any) => {
    assert.equal(options.audience, 'test-client'); assert.equal(options.idToken, 'signed-token');
    return { getPayload: () => identity };
  });
}
const identity = { sub: 'google-user', email: 'person@gmail.com', email_verified: true };
const request = () => ({ body: { idToken: 'signed-token' } }) as any;

test('Google new user receives registration proof without creating an account', async t => {
  setup(t, identity); t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User, 'create', () => { throw new Error('Must not create before completing registration'); });
  const res = response(); await verifyGoogle(request(), res as any);
  assert.equal(res.code, 200); assert.equal(res.body.isNewUser, true); assert.equal(res.body.token, undefined);
  const proof = jwt.verify(res.body.registrationToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
  assert.equal(proof.purpose, 'registration'); assert.equal(proof.googleId, identity.sub); assert.equal(proof.email, identity.email);
});
test('Google rejects invalid tokens before looking up an account', async t => {
  setup(t, identity); t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => { throw new Error('bad signature'); });
  t.mock.method(User, 'findOne', () => { throw new Error('Must not access users'); });
  const res = response(); await verifyGoogle(request(), res as any); assert.equal(res.code, 401);
});
test('Google rejects unverified emails', async t => {
  setup(t, { ...identity, email_verified: false });
  const res = response(); await verifyGoogle(request(), res as any); assert.equal(res.code, 401);
});
test('unlinked third-party email requires email OTP', async t => {
  setup(t, { ...identity, email: 'person@example.com' }); t.mock.method(User, 'findOne', async () => null);
  const res = response(); await verifyGoogle(request(), res as any); assert.equal(res.code, 403); assert.match(res.body.message, /Continue with Email/);
});
test('Google blocks unavailable accounts', async t => {
  setup(t, identity); t.mock.method(User, 'findOne', async () => ({ email: identity.email, accountStatus: 'blocked' }));
  const res = response(); await verifyGoogle(request(), res as any); assert.equal(res.code, 403);
});
test('existing email account links Google and receives an access token', async t => {
  setup(t, identity);
  const user = { _id: '507f1f77bcf86cd799439011', email: identity.email, name: 'Person', mobile: '9876543210', accountStatus: 'active' };
  t.mock.method(User, 'findOne', async (query: any) => query.googleId ? null : user);
  t.mock.method(User, 'updateOne', async (_query: any, update: any) => { assert.equal(update.$set.googleId, identity.sub); return { matchedCount: 1 }; });
  const res = response(); await verifyGoogle(request(), res as any);
  assert.equal(res.code, 200); assert.equal(res.body.isNewUser, false); assert.equal(res.body.user._id, user._id);
  const token = jwt.verify(res.body.token, process.env.JWT_SECRET!) as jwt.JwtPayload; assert.equal(token.userId, user._id); assert.equal(token.purpose, 'access');
});
