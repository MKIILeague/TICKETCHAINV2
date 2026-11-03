import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAppUpdate } from '../src/appUpdate.js';
import { beginPublication, isPublishing, subscribePublishing } from '../src/publicationActivity.js';

class Worker extends EventTarget {
  constructor(state = 'installed') { super(); this.state = state; this.messages = []; }
  postMessage(message) { this.messages.push(message); }
  change(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}
const container = () => new EventTarget();

test('an already-activated update or obsolete notice reloads immediately', async () => {
  let reloads = 0;
  await applyAppUpdate({ registration: { waiting: null, installing: null }, serviceWorker: container(), reload: () => reloads++ });
  assert.equal(reloads, 1);
});
test('waiting worker activation reloads even without a Workbox controlling callback', async () => {
  const worker = new Worker(); let reloads = 0;
  const update = applyAppUpdate({ registration: { waiting: worker }, serviceWorker: container(), reload: () => reloads++ });
  assert.deepEqual(worker.messages, [{ type: 'SKIP_WAITING' }]);
  assert.equal(reloads, 0);
  worker.change('activated'); await update;
  assert.equal(reloads, 1);
});
test('installing updates are awaited and activation/controller events reload only once', async () => {
  const worker = new Worker('installing'), sw = container(); let reloads = 0;
  const update = applyAppUpdate({ registration: { installing: worker }, serviceWorker: sw, reload: () => reloads++ });
  assert.equal(worker.messages.length, 0);
  worker.change('installed');
  assert.equal(worker.messages.length, 1);
  worker.change('activating'); sw.dispatchEvent(new Event('controllerchange'));
  worker.change('activated'); sw.dispatchEvent(new Event('controllerchange'));
  await update; assert.equal(reloads, 1);
});
test('a stalled activation retires only the app worker, reloads and removes late listeners', async () => {
  const worker = new Worker(), sw = container(); let reloads = 0, retired = 0;
  await applyAppUpdate({ registration: { waiting: worker, unregister: async () => { retired++; return true; } }, serviceWorker: sw,
    reload: () => reloads++, timeoutMs: 5 });
  worker.change('activated'); sw.dispatchEvent(new Event('controllerchange'));
  assert.equal(reloads, 1); assert.equal(retired, 1);
});
test('a publication in progress prevents requesting activation or reloading', async () => {
  const worker = new Worker(); let reloads = 0;
  await assert.rejects(applyAppUpdate({ registration: { waiting: worker }, serviceWorker: container(),
    reload: () => reloads++, isBusy: () => true }), /publishing is in progress/);
  assert.equal(worker.messages.length, 0); assert.equal(reloads, 0);
});
test('a publication started during activation also prevents reload', async () => {
  const worker = new Worker(); let busy = false, reloads = 0;
  const update = applyAppUpdate({ registration: { waiting: worker }, serviceWorker: container(),
    reload: () => reloads++, isBusy: () => busy });
  busy = true; worker.change('activated');
  await assert.rejects(update, /publishing is in progress/);
  assert.equal(reloads, 0);
});
test('a replaced worker recovers instead of getting stuck in an update loop', async () => {
  const worker = new Worker(); let reloads = 0;
  const update = applyAppUpdate({ registration: { waiting: worker, unregister: async () => true }, serviceWorker: container(), reload: () => reloads++ });
  worker.change('redundant'); await update; assert.equal(reloads, 1);
});
test('the real registration can be recovered before the React callback is ready', async () => {
  const worker = new Worker(), sw = container(); let reloads = 0;
  sw.getRegistration = async () => ({ waiting: worker });
  const update = applyAppUpdate({ registration: null, serviceWorker: sw, reload: () => reloads++ });
  await Promise.resolve(); worker.change('activated'); await update;
  assert.equal(reloads, 1);
});
test('activation messaging failures recover and clean up listeners', async () => {
  const worker = new Worker(); let reloads = 0;
  worker.postMessage = () => { throw new Error('Messaging failed'); };
  await applyAppUpdate({ registration: { waiting: worker, unregister: async () => true }, serviceWorker: container(), reload: () => reloads++ });
  worker.change('activated'); assert.equal(reloads, 1);
});
test('publication tracking remains active until all publishing work finishes', () => {
  const first = beginPublication(), second = beginPublication();
  try {
    assert.equal(isPublishing(), true);
    first(); first(); assert.equal(isPublishing(), true);
    second(); assert.equal(isPublishing(), false);
  } finally { first(); second(); }
});
test('publication subscribers receive completion changes and can unsubscribe', () => {
  const seen = [];
  const unsubscribe = subscribePublishing(() => seen.push(isPublishing()));
  const end = beginPublication(); end(); unsubscribe();
  const another = beginPublication(); another();
  assert.deepEqual(seen, [true, false]);
});
