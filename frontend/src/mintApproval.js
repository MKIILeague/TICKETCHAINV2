import { TRANSACTION_GAS_CAP } from './mintBatches.js';

const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const notSubmitted = (message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code: 'MINT_NOT_SUBMITTED' });

// A fresh sender is created for every Publish/Resume action. Approval is never
// persisted and applies only to this exact event, wallet and remaining supply.
export function createMintApprovalSender({ contract, record, sendTransaction, signal, waitForReceipt }) {
  const request = Object.freeze({ ...record.request });
  const walletAddress = record.walletAddress;
  const provider = contract.runner.provider;
  let approved = false;
  let firstConfirmed = 0;
  let submitted = 0;
  let sending = false;

  return async ({ args, gasLimit, submissionNonce, confirmedQuantity }) => {
    if (sending) throw notSubmitted('A mint submission is already in progress.');
    sending = true;
    let quantity;
    try {
      try {
        quantity = Number(args[4]);
        if (signal?.aborted) throw notSubmitted('Publication paused before the next batch was sent.');
        if (!Number.isSafeInteger(confirmedQuantity) || confirmedQuantity < 0 ||
            !Number.isSafeInteger(quantity) || quantity < 1 || confirmedQuantity + quantity > request.quantity ||
            (approved && confirmedQuantity !== firstConfirmed + submitted) ||
            !sameAddress(args[0], walletAddress) || args[1] !== request.tokenURI ||
            BigInt(args[2]) !== BigInt(request.priceWei) || args[3] !== request.eventName ||
            BigInt(gasLimit) <= 0n || BigInt(gasLimit) > TRANSACTION_GAS_CAP) {
          throw notSubmitted('This batch does not match the approved event or remaining supply.');
        }
        if (!sameAddress(await contract.getAddress(), request.contractAddress) ||
            !sameAddress(await contract.runner.getAddress(), walletAddress) ||
            Number((await provider.getNetwork()).chainId) !== request.chainId) {
          throw notSubmitted('The organizer wallet, contract or network changed. Resume with the original account.');
        }
        if (signal?.aborted) throw notSubmitted('Publication paused before the next batch was sent.');
      } catch (error) {
        if (error.code === 'MINT_NOT_SUBMITTED') throw error;
        throw notSubmitted('Could not verify this mint request before sending it.', error);
      }

      const remaining = request.quantity - confirmedQuantity;
      const { hash } = await sendTransaction({
        from: walletAddress, to: request.contractAddress,
        data: contract.interface.encodeFunctionData('batchMintTickets', args),
        value: 0n, chainId: request.chainId, gasLimit: BigInt(gasLimit), nonce: submissionNonce,
      }, {
        address: walletAddress,
        uiOptions: {
          showWalletUIs: !approved,
          buttonText: `Publish ${remaining} tickets`,
          description: `Publish ${remaining} remaining tickets for "${request.eventName}". This confirmation authorizes all remaining mint batches for this event. Each batch pays network gas. You can stop after the current batch.`,
        },
      });
      if (!/^0x[\da-fA-F]{64}$/.test(hash || '')) throw new Error('The wallet did not return a valid transaction hash. Check the wallet before resuming.');
      if (!approved) { firstConfirmed = confirmedQuantity; approved = true; }
      submitted += quantity;
      return {
        hash,
        wait: () => waitForReceipt ? waitForReceipt(hash) : provider.waitForTransaction(hash, 1, 180_000),
      };
    } finally { sending = false; }
  };
}
