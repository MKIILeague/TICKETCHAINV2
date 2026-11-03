import test from 'node:test';
import assert from 'node:assert/strict';
import { routeWalletRpc } from '../src/walletRpc.js';

function setup(chain = 11155111, allowLocal = false) {
  const walletCalls = [], readCalls = [];
  const wallet = { request: async ({ method, params }) => {
    walletCalls.push({ method, params });
    if (method === 'eth_chainId') return '0x' + chain.toString(16);
    if (method === 'eth_sendTransaction') return '0xhash';
    if (method === 'eth_accounts') return ['0xaccount'];
    throw new Error('Privy shared RPC is unavailable');
  } };
  const provider = routeWalletRpc(wallet, { allowLocal, readProviderFor: (chainId) => ({
    send: async (method, params) => { readCalls.push({ chainId, method, params }); return '0xresult'; },
  }) });
  return { provider, walletCalls, readCalls };
}

test('purchase, resale, admin and receipt reads work while the wallet RPC is unavailable', async () => {
  const { provider, walletCalls, readCalls } = setup();
  for (const method of ['eth_blockNumber', 'eth_getBalance', 'eth_getLogs', 'eth_call', 'eth_estimateGas',
    'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBlockByNumber', 'eth_getTransactionCount',
    'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory']) {
    assert.equal(await provider.request({ method, params: ['arg'] }), '0xresult');
    assert.equal(readCalls.at(-1).method, method);
    assert.deepEqual(readCalls.at(-1).params, ['arg']);
    assert.equal(readCalls.at(-1).chainId, 11155111);
  }
  assert.ok(walletCalls.every((call) => call.method === 'eth_chainId'));
});
test('accounts and transaction approval remain with the wallet, and submission is not retried', async () => {
  const { provider, walletCalls, readCalls } = setup();
  assert.deepEqual(await provider.request({ method: 'eth_accounts' }), ['0xaccount']);
  const tx = { from: '0xaccount', to: '0xcontract', value: '0x0' };
  assert.equal(await provider.request({ method: 'eth_sendTransaction', params: [tx] }), '0xhash');
  assert.equal(walletCalls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
  assert.equal(readCalls.length, 0);
});
test('a rejected or ambiguous wallet submission is never sent a second time', async () => {
  let sends = 0;
  const provider = routeWalletRpc({ request: async ({ method }) => {
    if (method === 'eth_chainId') return '0xaa36a7';
    sends++; throw new Error('Submission response lost');
  } }, { readProviderFor: () => { throw new Error('Unexpected read'); } });
  await assert.rejects(provider.request({ method: 'eth_sendTransaction', params: [{}] }), /response lost/);
  assert.equal(sends, 1);
});
test('production rejects reads and sends on mainnet or a local development chain', async () => {
  for (const chain of [1, 31337]) {
    const { provider, walletCalls, readCalls } = setup(chain);
    for (const method of ['eth_getBalance', 'eth_sendTransaction']) {
      await assert.rejects(provider.request({ method, params: [{}] }), /Switch your wallet to Sepolia/);
    }
    assert.equal(readCalls.length, 0);
    assert.ok(walletCalls.every((call) => call.method === 'eth_chainId'));
  }
});
test('local development routes to its local read provider only when explicitly enabled', async () => {
  const { provider, readCalls } = setup(31337, true);
  await provider.request({ method: 'eth_blockNumber' });
  assert.equal(readCalls[0].chainId, 31337);
});
