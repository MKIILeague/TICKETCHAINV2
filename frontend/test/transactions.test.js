import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmTransaction, sendContractTransaction, setOrganizerAccess, transactionError } from '../src/transactions.js';

function setup({ balance = 1_000_000n, gas = 100n, fee = 2n } = {}) {
  const sends = [];
  const contract = { runner: {
    getAddress: async () => '0xwallet',
    provider: { getBlock: async () => ({ gasLimit: 30_000_000n }),
      getBalance: async () => balance, getFeeData: async () => ({ maxFeePerGas: fee, gasPrice: fee }) },
  } };
  for (const method of ['purchaseResaleTicket', 'whitelistOrganizer', 'revokeOrganizer']) {
    contract[method] = Object.assign(async (...args) => {
      sends.push({ method, args });
      return { hash: '0xhash', wait: async () => ({ status: 1 }) };
    }, { estimateGas: async () => gas });
  }
  return { contract, sends };
}
test('actual fee estimate allows a small funded balance and always sends zero ticket payment', async () => {
  const { contract, sends } = setup({ balance: 300n });
  await confirmTransaction(await sendContractTransaction(contract, 'purchaseResaleTicket', [4]));
  assert.deepEqual(sends, [{ method: 'purchaseResaleTicket', args: [4, { value: 0n, gasLimit: 120n }] }]);
});
test('an estimate failure never falls back to a guessed gas limit or submits a transaction', async () => {
  const { contract, sends } = setup();
  contract.purchaseResaleTicket.estimateGas = async () => { throw new Error('RPC failed'); };
  await assert.rejects(sendContractTransaction(contract, 'purchaseResaleTicket', [4]), /RPC failed/);
  assert.equal(sends.length, 0);
});
test('insufficient fee balance and oversized purchases fail before wallet submission', async () => {
  const poor = setup({ balance: 239n });
  await assert.rejects(sendContractTransaction(poor.contract, 'purchaseResaleTicket', [4]), /Insufficient Sepolia ETH/);
  assert.equal(poor.sends.length, 0);
  const large = setup({ gas: 16_000_000n });
  await assert.rejects(sendContractTransaction(large.contract, 'purchaseResaleTicket', [4]), /Select fewer tickets/);
  assert.equal(large.sends.length, 0);
});
test('approval database retry does not submit a second on-chain approval', async () => {
  const { contract, sends } = setup(); let allowed = false;
  contract.whitelistedOrganizers = async () => allowed;
  const send = contract.whitelistOrganizer;
  contract.whitelistOrganizer = Object.assign(async (...args) => { const tx = await send(...args); allowed = true; return tx; },
    { estimateGas: send.estimateGas });
  const first = await setOrganizerAccess(contract, '0xorganizer', true, async () => { throw new Error('database offline'); });
  assert.equal(first.synced, false); assert.equal(allowed, true);
  let synced = false;
  const retry = await setOrganizerAccess(contract, '0xorganizer', true, async () => { synced = true; });
  assert.equal(retry.synced, true); assert.equal(synced, true); assert.equal(sends.length, 1);
});
test('an already-revoked organizer only needs the database state synchronized', async () => {
  const { contract, sends } = setup(); contract.whitelistedOrganizers = async () => false;
  let synced = false;
  await setOrganizerAccess(contract, '0xorganizer', false, async () => { synced = true; });
  assert.equal(synced, true); assert.equal(sends.length, 0);
});
test('receipt timeout retains the hash and warns against sending the action again', async () => {
  let failure;
  try { await confirmTransaction({ hash: '0xpending', wait: async () => { throw new Error('Receipt timed out'); } }); }
  catch (error) { failure = error; }
  assert.equal(failure.transactionHash, '0xpending');
  assert.match(transactionError(failure), /0xpending.*Check its status before sending/);
});
test('successful replacement confirms, while a canceled replacement and reverted receipts fail', async () => {
  assert.equal((await confirmTransaction({ wait: async () => {
    throw Object.assign(new Error('Repriced'), { code: 'TRANSACTION_REPLACED', cancelled: false, receipt: { status: 1 } });
  } })).status, 1);
  await assert.rejects(confirmTransaction({ hash: '0xhash', wait: async () => {
    throw Object.assign(new Error('Canceled'), { code: 'TRANSACTION_REPLACED', cancelled: true, receipt: { status: 1 } });
  } }), /Canceled/);
  await assert.rejects(confirmTransaction({ hash: '0xhash', wait: async () => ({ status: 0 }) }), /failed on-chain/);
});
test('wallet rejection and transport errors have readable messages', () => {
  assert.match(transactionError({ code: 'ACTION_REJECTED', message: 'rejected' }), /cancelled/);
  assert.match(transactionError({ message: 'could not coalesce error: HTTP request failed' }), /Sepolia network/);
});
