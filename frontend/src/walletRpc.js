// Wallet RPC is reserved for account access and signatures. Chain reads,
// estimates and receipt polling use the application's read provider instead.
const READ_METHODS = new Set([
  'eth_blockNumber', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBalance', 'eth_getCode',
  'eth_getStorageAt', 'eth_getLogs', 'eth_getTransactionCount',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt',
  'eth_getBlockByNumber', 'eth_getBlockByHash',
]);

export function routeWalletRpc(walletProvider, { readProviderFor, allowLocal = false }) {
  return {
    async request({ method, params = [] }) {
      if (!READ_METHODS.has(method) && method !== 'eth_sendTransaction' && method !== 'eth_sendRawTransaction') {
        return walletProvider.request({ method, params });
      }
      const chainId = Number(await walletProvider.request({ method: 'eth_chainId' }));
      if (chainId !== 11155111 && !(allowLocal && chainId === 31337)) {
        throw new Error('Switch your wallet to Sepolia before sending a transaction.');
      }
      if (READ_METHODS.has(method)) return readProviderFor(chainId).send(method, params);
      // A wallet submission is never retried automatically: an uncertain
      // response may already have broadcast the transaction.
      return walletProvider.request({ method, params });
    },
  };
}
