import test from 'node:test';
import assert from 'node:assert/strict';
import { getPublishedBuild } from '../src/appVersion.js';

test('the published build check bypasses caches and reads the actual build ID', async () => {
  let request;
  const id = await getPublishedBuild(async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ buildId: 'release-2' }));
  });
  assert.equal(id, 'release-2');
  assert.match(request.url, /^\/app-version\.json\?check=\d+$/);
  assert.equal(request.options.cache, 'no-store');
});
test('failed version requests do not announce an invented update', async () => {
  await assert.rejects(getPublishedBuild(async () => new Response('', { status: 503 })), /Could not check/);
});
test('an old SPA fallback response is not mistaken for a new version', async () => {
  await assert.rejects(getPublishedBuild(async () => new Response('<!doctype html><html></html>')));
});
test('a missing or invalid build ID is rejected', async () => {
  for (const version of [{}, { buildId: 2 }, { buildId: '' }]) {
    await assert.rejects(getPublishedBuild(async () => new Response(JSON.stringify(version))), /Invalid published/);
  }
});
