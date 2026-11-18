import { Transaction } from 'ethers';

// EIP-7825 limits individual Ethereum/Sepolia transactions independently of
// the block gas limit. Never replace a failed estimate with guessed gas.
export const TRANSACTION_GAS_CAP = 16_777_216n;
const buffered = (gas) => (BigInt(gas) * 120n + 99n) / 100n;

export async function planMintBatch(remaining, estimate, gasCap = TRANSACTION_GAS_CAP) {
  if (!Number.isSafeInteger(remaining) || remaining < 1) throw new Error('Invalid remaining ticket quantity.');
  gasCap = BigInt(gasCap) < TRANSACTION_GAS_CAP ? BigInt(gasCap) : TRANSACTION_GAS_CAP;
  const single = BigInt(await estimate(1));
  if (single <= 0n || buffered(single) > gasCap) throw new Error('A single ticket cannot fit safely in this network transaction.');
  // Estimating one first gives a conservative starting size without asking the
  // RPC to execute an oversized event. Estimate the actual batch again below.
  let quantity = Math.min(remaining, Number(gasCap / buffered(single)));
  while (quantity > 0) {
    try {
      const gasLimit = quantity === 1 ? buffered(single) : buffered(await estimate(quantity));
      if (gasLimit <= gasCap) return { quantity, gasLimit };
    } catch (error) {
      const message = error.info?.error?.message || error.shortMessage || error.message || '';
      if (error.reason || !/out of gas|exceeds.*gas|gas.*(?:limit|cap)|request exceeds defined limit/i.test(message)) throw error;
    }
    quantity = Math.floor(quantity / 2);
  }
  throw new Error('Could not estimate a safe mint transaction. No transaction was sent.');
}

const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export async function waitForMintReceipt(provider, hash, { signal, timeoutMs = 180_000, intervalMs = 4_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!signal?.aborted) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt) return receipt;
    } catch (error) {
      const message = error.info?.error?.message || error.shortMessage || error.message || '';
      if (!['TIMEOUT', 'SERVER_ERROR', 'NETWORK_ERROR'].includes(error.code) &&
          !/limit exceeded|exceeds defined limit|too many requests|rate limit|failed to fetch/i.test(message)) throw error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  if (signal?.aborted) throw new Error('Publication paused. The submitted transaction is saved for resuming.');
  throw new Error('Confirmation is taking longer than expected. Resume publication to keep checking the saved transaction.');
}

export async function mintEventBatches({ contract, record, save, onProgress = () => {}, gasCap = TRANSACTION_GAS_CAP, signal, signBatch, broadcast, recoveryHash }) {
  let state = structuredClone(record);
  const request = state.request;
  if (!request || !Number.isSafeInteger(request.quantity) || request.quantity < 1 ||
      !Array.isArray(state.ticketIds) || !Array.isArray(state.mintTransactions) || new Set(state.ticketIds).size !== state.ticketIds.length ||
      state.ticketIds.length > request.quantity) throw new Error('Invalid mint recovery record.');
  const provider = contract.runner.provider;
  if (!sameAddress(await contract.runner.getAddress(), state.walletAddress) ||
      !sameAddress(await contract.getAddress(), request.contractAddress) ||
      Number((await provider.getNetwork()).chainId) !== request.chainId) {
    throw new Error('Switch to the original organizer wallet, contract and network to resume.');
  }
  const checkpoint = async (patch) => {
    state = { ...state, ...patch };
    // This must succeed BEFORE the next wallet request. A storage error must
    // never silently discard knowledge of already-confirmed transactions.
    await save(structuredClone(state));
  };
  const progress = (batchStatus) => onProgress({
    minted: state.ticketIds.length, total: request.quantity,
    batchStatus,
  });
  const mintArgs = (quantity) => [state.walletAddress, request.tokenURI, BigInt(request.priceWei), request.eventName, quantity];
  const checkActive = () => {
    if (signal?.aborted) throw new Error('Publication paused. Confirmed tickets are saved; reopen Events to resume.');
  };

  const matchesBatch = (tx, quantity, nonce) =>
    !!tx && sameAddress(tx.from, state.walletAddress) && sameAddress(tx.to, request.contractAddress) &&
    (nonce == null || tx.nonce === nonce) && tx.value === 0n &&
    tx.data === contract.interface.encodeFunctionData('batchMintTickets', mintArgs(quantity));
  const matchesPendingBatch = (tx) => matchesBatch(tx, state.batchQuantity, state.submissionNonce);
  const settle = async (receipt, hash) => {
    if (!receipt) throw new Error('Your last mint transaction is still pending. Wait, then resume; do not submit it again.');
    if (!matchesPendingBatch(await provider.getTransaction(hash))) {
      throw new Error('This transaction does not match the pending event batch. Check its hash before resuming.');
    }
    if (Number(receipt.status) !== 1) {
      await checkpoint({ pendingHash: null, signedTransaction: null, submitting: false, batchQuantity: null });
      throw new Error('The last batch failed on-chain. Confirmed earlier batches are saved; resume to retry only the remaining tickets.');
    }
    const ids = receipt.logs.flatMap((log) => {
      if (!sameAddress(log.address, request.contractAddress)) return [];
      try {
        const event = contract.interface.parseLog(log);
        return event?.name === 'TicketMinted' && sameAddress(event.args[1], state.walletAddress)
          ? [event.args[0].toString()] : [];
      } catch { return []; }
    });
    if (ids.length !== state.batchQuantity || new Set([...state.ticketIds, ...ids]).size !== state.ticketIds.length + ids.length ||
        state.ticketIds.length + ids.length > request.quantity) {
      throw new Error('The receipt does not contain the expected new ticket IDs. Stop and check this transaction.');
    }
    await checkpoint({
      ticketIds: [...state.ticketIds, ...ids],
      mintTransactions: [...state.mintTransactions, { hash, quantity: ids.length, blockNumber: receipt.blockNumber }],
      firstMintBlock: state.firstMintBlock ?? receipt.blockNumber,
      pendingHash: null, signedTransaction: null, submitting: false, batchQuantity: null,
    });
    progress();
  };

  const verifySignedBatch = (serialized, quantity, nonce) => {
    const tx = Transaction.from(serialized);
    if (!tx.hash || tx.chainId !== BigInt(request.chainId) || !matchesBatch(tx, quantity, nonce)) {
      throw new Error('The signed transaction does not match this mint batch.');
    }
    return tx;
  };
  const broadcastSavedBatch = async () => {
    const { pendingHash, signedTransaction, batchQuantity, submissionNonce } = state;
    const tx = verifySignedBatch(signedTransaction, batchQuantity, submissionNonce);
    if (tx.hash !== pendingHash) throw new Error('The saved mint transaction hash does not match.');
    progress('broadcasting');
    try {
      if (await broadcast(signedTransaction) !== pendingHash) throw new Error('The network returned a different transaction hash.');
    } catch {
      // The node may have accepted the exact transaction before the response failed.
      if (!await provider.getTransaction(pendingHash).catch(() => null)) {
        throw new Error('Could not confirm that the network accepted this batch. Resume to check it and retry the same transaction.');
      }
    }
    progress('confirming');
    const receipt = await waitForMintReceipt(provider, pendingHash, { signal });
    await settle(receipt, pendingHash);
  };

  progress();
  if (recoveryHash && !state.signedTransaction && (state.submitting || state.pendingHash)) {
    if (!matchesPendingBatch(await provider.getTransaction(recoveryHash))) {
      throw new Error('The supplied transaction could not be verified as this event’s batch.');
    }
    await checkpoint({ pendingHash: recoveryHash, submitting: false });
  }
  if (state.submitting && !state.pendingHash) {
    // Older records may only contain the nonce. Locate the block where that
    // nonce was mined, then verify the transaction before trusting its hash.
    let recovered;
    if (Number.isSafeInteger(state.submissionNonce)) {
      try {
        let high = await provider.getBlockNumber();
        if (await provider.getTransactionCount(state.walletAddress, high) > state.submissionNonce) {
          let low = 0;
          while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (await provider.getTransactionCount(state.walletAddress, mid) > state.submissionNonce) high = mid;
            else low = mid + 1;
          }
          const block = await provider.getBlock(low, true);
          recovered = block?.prefetchedTransactions.find(matchesPendingBatch);
        }
      } catch {
        // Historical lookup can be unavailable. A manually supplied hash can still be verified.
      }
    }
    if (!recovered) throw new Error('The wallet submission was interrupted before its hash was saved. Check wallet activity and paste the transaction hash below if it was submitted.');
    await checkpoint({ pendingHash: recovered.hash, submitting: false });
  }
  if (state.pendingHash) {
    if (state.signedTransaction && !await provider.getTransaction(state.pendingHash).catch(() => null)) {
      checkActive();
      await broadcastSavedBatch();
    } else {
      progress('confirming');
      const receipt = await waitForMintReceipt(provider, state.pendingHash, { signal });
      await settle(receipt, state.pendingHash);
    }
  }
  while (state.ticketIds.length < request.quantity) {
    checkActive();
    const block = await provider.getBlock('latest');
    const budget = block.gasLimit < BigInt(gasCap) ? block.gasLimit : BigInt(gasCap);
    const batch = await planMintBatch(
      request.quantity - state.ticketIds.length,
      (quantity) => contract.batchMintTickets.estimateGas(...mintArgs(quantity)),
      budget,
    );
    const submissionNonce = await contract.runner.getNonce('pending');
    checkActive();
    progress('signing');
    if (signBatch) {
      const signedTransaction = await signBatch({
        args: mintArgs(batch.quantity), gasLimit: batch.gasLimit, submissionNonce, confirmedQuantity: state.ticketIds.length,
      });
      const tx = verifySignedBatch(signedTransaction, batch.quantity, submissionNonce);
      if (tx.gasLimit !== batch.gasLimit) throw new Error('The wallet changed the estimated gas limit.');
      checkActive();
      await checkpoint({ pendingHash: tx.hash, signedTransaction, batchQuantity: batch.quantity, submissionNonce });
      await broadcastSavedBatch();
      continue;
    }
    await checkpoint({ submitting: true, batchQuantity: batch.quantity, submissionNonce });
    if (signal?.aborted) {
      await checkpoint({ submitting: false, batchQuantity: null });
      checkActive();
    }
    let tx;
    try {
      tx = await contract.batchMintTickets(...mintArgs(batch.quantity), { gasLimit: batch.gasLimit });
    } catch (error) {
      // A rejected wallet prompt did not broadcast. Other ambiguous failures
      // retain the submission marker so reload/retry cannot blindly mint again.
      const hash = error.info?.sendTransactionHash;
      if (/^0x[\da-fA-F]{64}$/.test(hash || '')) {
        await checkpoint({ pendingHash: hash, submitting: false });
      } else if (error.code === 'ACTION_REJECTED' || error.code === 'MINT_NOT_SUBMITTED') {
        await checkpoint({ submitting: false, batchQuantity: null });
      }
      throw error;
    }
    await checkpoint({ pendingHash: tx.hash, submitting: false, submissionNonce: tx.nonce ?? submissionNonce });
    progress('confirming');
    let receipt;
    try { receipt = await tx.wait(1, 180_000); }
    catch (error) {
      if (error.code === 'TRANSACTION_REPLACED' && error.cancelled) {
        await checkpoint({ pendingHash: null, submitting: false, batchQuantity: null });
        throw new Error('The wallet cancelled this batch. Earlier confirmed tickets are saved.', { cause: error });
      }
      if (!error.receipt) throw error;
      receipt = error.receipt;
    }
    const confirmedHash = receipt.hash || receipt.transactionHash || tx.hash;
    if (confirmedHash !== state.pendingHash) await checkpoint({ pendingHash: confirmedHash });
    await settle(receipt, confirmedHash);
  }
  await checkpoint({
    stage: 'sync',
    payload: {
      ...state.payload, mintBlock: state.firstMintBlock, ticketIds: state.ticketIds,
      txHash: state.mintTransactions[0].hash, txHashes: state.mintTransactions.map((tx) => tx.hash),
    },
  });
  return state;
}
