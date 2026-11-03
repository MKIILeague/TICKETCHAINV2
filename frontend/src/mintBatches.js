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
      if (error.reason || !/out of gas|exceeds.*gas|gas.*(?:limit|cap)/i.test(message)) throw error;
    }
    quantity = Math.floor(quantity / 2);
  }
  throw new Error('Could not estimate a safe mint transaction. No transaction was sent.');
}

const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export async function mintEventBatches({ contract, record, save, onProgress = () => {}, gasCap = TRANSACTION_GAS_CAP, signal, sendBatch }) {
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
  const progress = (batchQuantity = 0) => onProgress({
    minted: state.ticketIds.length, total: request.quantity,
    batchNumber: state.mintTransactions.length + 1, batchQuantity,
  });
  const mintArgs = (quantity) => [state.walletAddress, request.tokenURI, BigInt(request.priceWei), request.eventName, quantity];
  const checkActive = () => {
    if (signal?.aborted) throw new Error('Publication paused. Confirmed tickets are saved; reopen Events to resume.');
  };

  const settle = async (receipt, hash) => {
    if (!receipt) throw new Error('Your last mint transaction is still pending. Wait, then resume; do not submit it again.');
    const tx = await provider.getTransaction(hash);
    const parsed = tx && contract.interface.parseTransaction({ data: tx.data, value: tx.value });
    if (!tx || !sameAddress(tx.from, state.walletAddress) || !sameAddress(tx.to, request.contractAddress) ||
        parsed?.name !== 'batchMintTickets' || !sameAddress(parsed.args[0], state.walletAddress) ||
        parsed.args[1] !== request.tokenURI || parsed.args[2] !== BigInt(request.priceWei) ||
        parsed.args[3] !== request.eventName || Number(parsed.args[4]) !== state.batchQuantity ||
        (state.submissionNonce != null && tx.nonce !== state.submissionNonce)) {
      throw new Error('This transaction does not match the pending event batch. Check its hash before resuming.');
    }
    if (Number(receipt.status) !== 1) {
      await checkpoint({ pendingHash: null, submitting: false, batchQuantity: null });
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
      pendingHash: null, submitting: false, batchQuantity: null,
    });
    progress();
  };

  progress();
  if (state.submitting && !state.pendingHash) {
    throw new Error('The wallet submission was interrupted before its hash was saved. Paste that transaction hash below to check it before resuming.');
  }
  if (state.pendingHash) await settle(await provider.getTransactionReceipt(state.pendingHash), state.pendingHash);
  while (state.ticketIds.length < request.quantity) {
    checkActive();
    const block = await provider.getBlock('latest');
    const budget = block.gasLimit < BigInt(gasCap) ? block.gasLimit : BigInt(gasCap);
    const batch = await planMintBatch(
      request.quantity - state.ticketIds.length,
      (quantity) => contract.batchMintTickets.estimateGas(...mintArgs(quantity)),
      budget,
    );
    progress(batch.quantity);
    const submissionNonce = await contract.runner.getNonce('pending');
    checkActive();
    await checkpoint({ submitting: true, batchQuantity: batch.quantity, submissionNonce });
    if (signal?.aborted) {
      await checkpoint({ submitting: false, batchQuantity: null });
      checkActive();
    }
    let tx;
    try {
      tx = sendBatch
        ? await sendBatch({ args: mintArgs(batch.quantity), gasLimit: batch.gasLimit, submissionNonce, confirmedQuantity: state.ticketIds.length })
        : await contract.batchMintTickets(...mintArgs(batch.quantity), { gasLimit: batch.gasLimit });
    } catch (error) {
      // A rejected wallet prompt did not broadcast. Other ambiguous failures
      // retain the submission marker so reload/retry cannot blindly mint again.
      if (error.code === 'ACTION_REJECTED' || error.code === 'MINT_NOT_SUBMITTED') await checkpoint({ submitting: false, batchQuantity: null });
      throw error;
    }
    await checkpoint({ pendingHash: tx.hash, submitting: false, submissionNonce: tx.nonce ?? submissionNonce });
    let receipt;
    try { receipt = await tx.wait(); }
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
