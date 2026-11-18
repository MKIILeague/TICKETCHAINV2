import { TRANSACTION_GAS_CAP } from './mintBatches.js';

const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const notSubmitted = (message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code: 'MINT_NOT_SUBMITTED' });

// A fresh sender is created for every Publish/Resume action. Approval is never
// persisted and applies only to this exact event, wallet and remaining supply.
export function createMintApprovalSigner({ contract, record, signTransaction, signal }) {
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
      let signature;
      try {
        const { maxFeePerGas, maxPriorityFeePerGas, gasPrice } = await provider.getFeeData();
        const fees = maxFeePerGas != null && maxPriorityFeePerGas != null
          ? { maxFeePerGas, maxPriorityFeePerGas } : { gasPrice };
        if ((fees.maxFeePerGas ?? fees.gasPrice) == null) throw new Error('Could not estimate Sepolia network fees.');
        if (signal?.aborted) throw new Error('Publication paused before signing the next batch.');
        ({ signature } = await signTransaction({
          from: walletAddress, to: request.contractAddress,
          data: contract.interface.encodeFunctionData('batchMintTickets', args),
          value: 0n, chainId: request.chainId, gasLimit: BigInt(gasLimit), nonce: submissionNonce, ...fees,
        }, {
          address: walletAddress,
          uiOptions: {
            showWalletUIs: !approved,
            buttonText: `Publish ${remaining} tickets`,
            description: `Publish ${remaining} remaining tickets for "${request.eventName}". This confirmation authorizes all remaining mint batches for this event. Each batch pays network gas. You can stop after the current batch.`,
          },
        }));
      } catch (error) {
        // Signing alone cannot submit a transaction.
        throw notSubmitted(error.shortMessage || error.message || 'Could not sign this mint batch.', error);
      }
      if (!approved) { firstConfirmed = confirmedQuantity; approved = true; }
      submitted += quantity;
      return signature;
    } finally { sending = false; }
  };
}
