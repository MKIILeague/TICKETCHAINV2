import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface } from 'ethers';
import { createMintApprovalSender } from '../src/mintApproval.js';

const wallet = '0x1111111111111111111111111111111111111111';
const address = '0x2222222222222222222222222222222222222222';
const other = '0x3333333333333333333333333333333333333333';
const iface = new Interface(JSON.parse(readFileSync(new URL('../src/TicketContract.json', import.meta.url))).abi);
function setup(overrides = {}) {
  const calls = [];
  const record = { walletAddress: wallet, request: { contractAddress: address, chainId: 11155111,
    tokenURI: 'ipfs://event', eventName: 'Festival', priceWei: '500', quantity: 50 } };
  const provider = { getNetwork: async () => ({ chainId: 11155111n }), waitForTransaction: async (hash) => ({ hash, status: 1 }) };
  const contract = { interface: iface, getAddress: async () => address,
    runner: { provider, getAddress: async () => wallet } };
  const sendTransaction = async (input, options) => {
    calls.push({ input, options });
    return { hash: '0x' + String(calls.length).padStart(64, '0') };
  };
  return { calls, record, contract, provider, sendTransaction,
    sender: createMintApprovalSender({ contract, record, sendTransaction, ...overrides }) };
}
const batch = (confirmedQuantity = 0, quantity = 13) => ({
  args: [wallet, 'ipfs://event', 500n, 'Festival', quantity],
  gasLimit: 15_000_000n, submissionNonce: confirmedQuantity, confirmedQuantity,
});
test('50 tickets require one publishing confirmation while batches stay separate', async () => {
  const { calls, sender } = setup();
  for (const [done, count] of [[0, 13], [13, 13], [26, 13], [39, 11]]) await sender(batch(done, count));
  assert.deepEqual(calls.map((c) => c.options.uiOptions.showWalletUIs), [true, false, false, false]);
  assert.match(calls[0].options.uiOptions.description, /50 remaining tickets/);
  assert.match(calls[0].options.uiOptions.description, /authorizes all remaining mint batches/);
  for (const { input, options } of calls) {
    assert.equal(input.to, address); assert.equal(input.value, 0n);
    assert.equal(input.chainId, 11155111); assert.equal(options.address, wallet);
    assert.equal(iface.parseTransaction({ data: input.data }).name, 'batchMintTickets');
  }
});
test('a fresh Resume operation asks again for the remaining supply', async () => {
  const { calls, sender } = setup();
  await sender(batch(26, 13));
  assert.equal(calls[0].options.uiOptions.showWalletUIs, true);
  assert.match(calls[0].options.uiOptions.description, /24 remaining tickets/);
});
test('a rejected first confirmation does not grant silent approval', async () => {
  const original = setup();
  const flags = [];
  const sender = createMintApprovalSender({ ...original, sendTransaction: async (_input, options) => {
    flags.push(options.uiOptions.showWalletUIs);
    if (flags.length === 1) throw Object.assign(new Error('Rejected'), { code: 'ACTION_REJECTED' });
    return { hash: '0x' + '1'.repeat(64) };
  } });
  await assert.rejects(sender(batch()), /Rejected/);
  await sender(batch());
  assert.deepEqual(flags, [true, true]);
});
for (const [name, mutate] of [
  ['recipient', (b) => { b.args[0] = other; }],
  ['metadata', (b) => { b.args[1] = 'ipfs://different-event'; }],
  ['price', (b) => { b.args[2] = 600n; }],
  ['event', (b) => { b.args[3] = 'Different event'; }],
  ['quantity', (b) => { b.args[4] = 51; }],
  ['gas budget', (b) => { b.gasLimit = 20_000_000n; }],
]) {
  test(`rejects a changed ${name} before sending`, async () => {
    const { calls, sender } = setup(); const request = batch(); mutate(request);
    await assert.rejects(sender(request), { code: 'MINT_NOT_SUBMITTED' });
    assert.equal(calls.length, 0);
  });
}
test('changing the wallet or network stops automatic submission', async () => {
  const context = setup();
  context.provider.getNetwork = async () => ({ chainId: 1n });
  await assert.rejects(context.sender(batch()), { code: 'MINT_NOT_SUBMITTED' });
  assert.equal(context.calls.length, 0);
});
test('stopping blocks the next batch without a wallet request', async () => {
  const controller = new AbortController();
  const { calls, sender } = setup({ signal: controller.signal });
  await sender(batch()); controller.abort();
  await assert.rejects(sender(batch(13)), { code: 'MINT_NOT_SUBMITTED' });
  assert.equal(calls.length, 1);
});
test('cannot reuse approval to restart a completed batch', async () => {
  const { calls, sender } = setup(); await sender(batch());
  await assert.rejects(sender(batch()), { code: 'MINT_NOT_SUBMITTED' });
  assert.equal(calls.length, 1);
});
