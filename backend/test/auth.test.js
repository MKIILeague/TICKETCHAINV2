import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createPrivyTokenVerifier } from '../middleware/auth.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const appId = 'test-app';
const verify = createPrivyTokenVerifier({ appId, resolveKey: (_header, cb) => cb(null, publicKey) });
const token = (options = {}, claims = { sub: 'did:privy:demo' }) => jwt.sign(claims, privateKey, {
  algorithm: 'ES256', issuer: 'privy.io', audience: appId, expiresIn: '1h', ...options,
});
function request(header) {
  return new Promise((resolve) => {
    const req = { headers: { authorization: header } };
    const res = { status(code) { this.code = code; return this; }, json(body) { resolve({ status: this.code, body }); } };
    verify(req, res, () => resolve({ status: 200, user: req.user }));
  });
}
test('accepts a correctly signed Privy ES256 token', async () => {
  const result = await request(`Bearer ${token()}`);
  assert.equal(result.status, 200);
  assert.equal(result.user.sub, 'did:privy:demo');
});
for (const [label, header] of [
  ['missing token', undefined], ['malformed token', 'Bearer invalid'],
  ['extra token', `Bearer ${token()} extra`], ['wrong audience', `Bearer ${token({ audience: 'other' })}`],
  ['wrong issuer', `Bearer ${token({ issuer: 'other' })}`], ['expired token', `Bearer ${token({ expiresIn: -1 })}`],
  ['missing subject', `Bearer ${token({}, {})}`],
  ['unsigned token', `Bearer ${jwt.sign({ sub: 'demo' }, null, { algorithm: 'none' })}`],
]) {
  test(`rejects ${label}`, async () => assert.equal((await request(header)).status, 401));
}
