import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateOwnLocation } from '../src/routes/auth.routes';
import User from '../src/models/User';

function response() {
  return { code: 200, body: null as any, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
}

test('location update rejects invalid coordinates and unrelated profile fields', async () => {
  for (const body of [
    { address: { state: '' } },
    { address: { state: 'Gujarat', latitude: 200, longitude: 72 } },
    { address: { state: 'Gujarat', latitude: 22 } },
    { address: { state: 'Gujarat', pincode: 'bad' } },
    { address: { state: 'Gujarat', role: 'admin' } },
    { address: { state: 'Gujarat' }, role: 'admin' },
  ]) {
    const res = response();
    await updateOwnLocation({ userId: 'signed-in-user', body } as any, res as any);
    assert.equal(res.code, 400);
  }
});

test('location updates target the authenticated user and replace stale address fields', async () => {
  const original = User.findByIdAndUpdate;
  const calls: any[] = [];
  User.findByIdAndUpdate = ((id: unknown, changes: any, options: unknown) => {
    calls.push({ id, changes, options });
    return { select: () => ({ lean: async () => ({ _id: id, address: changes.$set.address }) }) };
  }) as any;
  try {
    for (const address of [
      { state: 'Gujarat', city: 'Surat', area: 'Adajan', pincode: '395009', latitude: 21.2, longitude: 72.8 },
      { state: 'Gujarat' },
      { state: 'All in India' },
    ]) {
      const res = response();
      await updateOwnLocation({ userId: 'signed-in-user', params: { userId: 'another-user' }, body: { address } } as any, res as any);
      assert.equal(res.code, 200);
      assert.deepEqual(res.body.user.address, address);
      assert.deepEqual(calls.at(-1), { id: 'signed-in-user', changes: { $set: { address } }, options: { new: true, runValidators: true } });
    }
  } finally { User.findByIdAndUpdate = original; }
});
