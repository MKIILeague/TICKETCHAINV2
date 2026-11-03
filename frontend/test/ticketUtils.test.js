import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedTokenIds, ticketKey, parseTicketQr, queryTicketLogs } from '../src/ticketUtils.js';
import { withTimeout } from '../src/asyncUtils.js';

const alice = '0x1111111111111111111111111111111111111111';
const bob = '0x2222222222222222222222222222222222222222';
const contract = '0x3333333333333333333333333333333333333333';
const log = (from, to, block, id = 1n, index = 0) => ({
  args: [from, to, id], blockNumber: block, index, transactionHash: `tx${block}`,
});
test('a ticket transferred away and returned remains in the wallet', () => {
  const first = log(bob, alice, 1), sent = log(alice, bob, 2), returned = log(bob, alice, 3);
  assert.deepEqual(ownedTokenIds([returned, first], [sent], alice), ['1']);
});
test('outgoing and self-transfers are replayed in block and log order', () => {
  const first = log(bob, alice, 1), self = log(alice, alice, 2), sent = log(alice, bob, 3);
  assert.deepEqual(ownedTokenIds([self, first], [self], alice), ['1']);
  assert.deepEqual(ownedTokenIds([self, first], [sent, self], alice), []);
});
test('token IDs from separate contracts have distinct identities', () => {
  assert.notEqual(ticketKey({ id: '1', contractAddress: alice }), ticketKey({ id: '1', contractAddress: bob }));
});
const packet = { tokenId: '1', owner: alice, contract, chainId: 11155111, v: 1 };
const deployments = () => [{ address: contract }];
test('accepts a known ticket deployment and preserves the QR owner', () => {
  assert.deepEqual(parseTicketQr(JSON.stringify(packet), deployments), packet);
});
for (const [name, patch] of [
  ['unknown contract', { contract: bob }], ['unsupported network', { chainId: 1 }],
  ['zero ticket', { tokenId: 0 }], ['negative ticket', { tokenId: -1 }],
  ['fractional ticket', { tokenId: '1.5' }], ['missing owner', { owner: '' }], ['unknown version', { v: 2 }],
]) {
  test(`rejects QR with ${name}`, () => assert.throws(() => parseTicketQr(JSON.stringify({ ...packet, ...patch }), deployments)));
}
test('historical logs fall back to bounded non-overlapping windows', async () => {
  const calls = [];
  const fake = {
    runner: { provider: { getBlockNumber: async () => 20000 } },
    queryFilter: async (_filter, from, to) => {
      calls.push([from, to]);
      if (to - from >= 9000) throw new Error('Range too large');
      return [from];
    },
  };
  assert.deepEqual(await queryTicketLogs(fake, {}, 1), [1, 9001, 18001]);
  assert.deepEqual(calls, [[1, 20000], [1, 9000], [9001, 18000], [18001, 20000]]);
});
test('a deployment beyond the chain head has no logs', async () => {
  assert.deepEqual(await queryTicketLogs({ runner: { provider: { getBlockNumber: async () => 2 } } }, {}, 3), []);
});
test('stalled external requests time out', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5), /timed out/);
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000), 'ok');
});
