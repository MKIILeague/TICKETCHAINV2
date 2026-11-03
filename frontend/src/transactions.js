export async function confirmTransaction(tx, timeoutMs = 180_000) {
  try {
    const receipt = await tx.wait(1, timeoutMs);
    if (!receipt) throw new Error('The transaction is still pending.');
    if (Number(receipt.status) !== 1) throw new Error('The transaction failed on-chain.');
    return receipt;
  } catch (error) {
    if (error.code === 'TRANSACTION_REPLACED' && !error.cancelled && Number(error.receipt?.status) === 1) return error.receipt;
    error.transactionHash ||= error.receipt?.hash || tx.hash;
    throw error;
  }
}

export function transactionError(error) {
  const reason = error?.reason || error?.info?.error?.message || error?.data?.message || error?.shortMessage || error?.message || 'Transaction failed.';
  if (error?.code === 'ACTION_REJECTED' || error?.code === 4001 || /user rejected|user denied/i.test(reason)) return 'You cancelled the wallet confirmation.';
  const message = /failed to fetch|HTTP request failed|NETWORK_ERROR|could not coalesce/i.test(reason)
    ? 'Could not reach the Sepolia network. Check your connection and wallet activity before trying again.' : reason;
  return error?.transactionHash ? `${message} Transaction: ${error.transactionHash}. Check its status before sending another transaction.` : message;
}

// Database retry after a confirmed approval/revocation must not require a
// second blockchain transaction or report the confirmed operation as failed.
export async function setOrganizerAccess(contract, address, allowed, sync) {
  if (await contract.whitelistedOrganizers(address) !== allowed) {
    await confirmTransaction(await sendContractTransaction(contract, allowed ? 'whitelistOrganizer' : 'revokeOrganizer', [address]));
  }
  try { await sync(); return { synced: true }; }
  catch (error) { return { synced: false, error }; }
}
// Estimate the actual action instead of imposing a fixed ETH minimum or
// guessing a gas limit after an RPC error. All contract payments are simulated.
export async function sendContractTransaction(contract, method, args = []) {
  const provider = contract.runner.provider;
  const address = await contract.runner.getAddress();
  const gas = await contract[method].estimateGas(...args, { value: 0n });
  const gasLimit = (BigInt(gas) * 120n + 99n) / 100n;
  const block = await provider.getBlock('latest');
  const cap = block.gasLimit < 16_777_216n ? block.gasLimit : 16_777_216n;
  if (gasLimit > cap) throw new Error('This action exceeds one transaction gas limit. Select fewer tickets.');
  const [balance, fees] = await Promise.all([provider.getBalance(address), provider.getFeeData()]);
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  if (maxFeePerGas == null) throw new Error('Could not estimate network fees. Try again before confirming.');
  if (balance < gasLimit * maxFeePerGas) throw new Error('Insufficient Sepolia ETH for network gas. Fund this wallet and try again; ticket payments are simulated.');
  return contract[method](...args, { value: 0n, gasLimit });
}

