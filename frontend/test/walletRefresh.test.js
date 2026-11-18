import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('wallet refresh reads current cancellations and past events from Firestore', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    resolve: { alias: [
      { find: /^\.\/firebase$/, replacement: 'wallet-test-db' },
      { find: /^firebase\/firestore$/, replacement: 'wallet-test-firestore' },
    ] },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    plugins: [{
      name: 'mock-wallet-firestore',
      resolveId(id) {
        if (id === 'wallet-test-db' || id === 'wallet-test-firestore') return '\0' + id;
      },
      load(id) {
        if (id === '\0wallet-test-db') return 'export const db = {};';
        if (id !== '\0wallet-test-firestore') return;
        return `
          export const collection = () => {};
          export const query = () => {};
          export const where = () => {};
          export const doc = () => {};
          export const updateDoc = () => {};
          export const runTransaction = () => {};
          export const getDocs = () => { throw new Error('Unexpected cache read'); };
          let reads = 0;
          export const getDocsFromServer = async () => {
            if (++reads > 2) throw new Error('Firestore unavailable');
            const timestamp = Math.floor(Date.now() / 1000);
            const dates = { headline: 'Festival', timestamp: timestamp + (reads === 1 ? 600 : -600), status: 'published' };
            const lifecycle = { headline: 'Concert', timestamp: timestamp + 600, status: reads === 1 ? 'published' : 'canceled' };
            return [dates, lifecycle].map((data, id) => ({ id, data: () => data }));
          };
        `;
      },
    }],
  });
  try {
    const { fetchPublicEventStatusMap } = await server.ssrLoadModule('/src/eventStatus.js');
    const initial = await fetchPublicEventStatusMap({ fresh: true });
    assert.equal(initial.concert.status, 'published');
    assert.equal(initial.festival.status, 'published');
    const refreshed = await fetchPublicEventStatusMap({ fresh: true });
    assert.equal(refreshed.concert.status, 'canceled');
    assert.equal(refreshed.festival.status, 'finished');
    await assert.rejects(fetchPublicEventStatusMap({ fresh: true }), /Firestore unavailable/);
  } finally {
    await server.close();
  }
});
