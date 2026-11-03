import test from 'node:test';
import assert from 'node:assert/strict';
import { planMintBatch, TRANSACTION_GAS_CAP } from '../src/mintBatches.js';

test('150-ticket event is planned below the transaction cap using observed Sepolia costs', async () => {
  const estimatedQuantities = [];
  const plan = await planMintBatch(150, async (quantity) => {
    estimatedQuantities.push(quantity);
    return 1_060_473n + BigInt(quantity - 1) * 1_011_039n;
  });
  assert.ok(plan.quantity > 0 && plan.quantity < 150);
  assert.ok(plan.gasLimit <= TRANSACTION_GAS_CAP);
  assert.ok(estimatedQuantities.every((q) => q < 150));
});
test('a small event fits into one confirmation with an estimate and buffer', async () => {
  const plan = await planMintBatch(5, async (quantity) => 1_000_000n * BigInt(quantity));
  assert.equal(plan.quantity, 5);
  assert.ok(plan.gasLimit > 5_000_000n && plan.gasLimit <= TRANSACTION_GAS_CAP);
});
test('respects a smaller block or transaction budget', async () => {
  const plan = await planMintBatch(150, async (quantity) => 100_000n * BigInt(quantity), 1_000_000n);
  assert.ok(plan.gasLimit <= 1_000_000n);
});
test('shrinks the batch if the actual multi-ticket estimate exceeds its budget', async () => {
  const plan = await planMintBatch(100, async (quantity) => quantity === 1 ? 1_000_000n : BigInt(quantity) * 2_000_000n);
  assert.ok(plan.gasLimit <= TRANSACTION_GAS_CAP);
  assert.ok(plan.quantity < 13);
});
test('gas-limit errors shrink the candidate instead of guessing a limit', async () => {
  const plan = await planMintBatch(100, async (quantity) => {
    if (quantity > 5) throw new Error('out of gas');
    return BigInt(quantity) * 1_000_000n;
  });
  assert.ok(plan.quantity <= 5);
});
test('RPC failure prevents publication instead of generating a fallback gas value', async () => {
  await assert.rejects(planMintBatch(150, async () => { throw new Error('RPC unavailable'); }), /RPC unavailable/);
});
test('real contract reverts are not swallowed by size reduction', async () => {
  await assert.rejects(planMintBatch(150, async () => {
    throw Object.assign(new Error('Not a whitelisted organizer'), { reason: 'Not a whitelisted organizer' });
  }), /Not a whitelisted organizer/);
});
test('a single ticket exceeding the cap is rejected', async () => {
  await assert.rejects(planMintBatch(1, async () => TRANSACTION_GAS_CAP), /single ticket cannot fit/);
});
