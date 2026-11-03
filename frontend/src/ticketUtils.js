import { ethers } from 'ethers';

export const ticketKey = (ticket) => `${ticket.contractAddress.toLowerCase()}:${ticket.id}`;

// Replay transfers in chain order. Subtracting all outgoing IDs from incoming
// IDs incorrectly hides a token that is subsequently transferred BACK to us.
export function ownedTokenIds(incoming, outgoing, address) {
  const me = address.toLowerCase();
  const history = new Map();
  for (const log of [...incoming, ...outgoing]) {
    history.set(`${log.transactionHash}:${log.index}`, log);
  }
  const owned = new Set();
  const ordered = [...history.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  for (const log of ordered) {
    const [from, to, tokenId] = log.args;
    const id = tokenId.toString();
    if (from.toLowerCase() === me) owned.delete(id);
    if (to.toLowerCase() === me) owned.add(id);
  }
  return [...owned];
}

// A QR is an identifier, not a signature. Only accept known TicketChain
// deployments; the scanner must also verify its owner against live chain state.
export function parseTicketQr(raw, deploymentsForChain) {
  const packet = JSON.parse(raw);
  if (packet.v !== 1 || !/^\d+$/.test(String(packet.tokenId)) || BigInt(packet.tokenId) <= 0n) {
    throw new Error('Invalid TicketChain QR');
  }
  const chainId = Number(packet.chainId);
  if (![31337, 11155111].includes(chainId)) throw new Error('Unsupported QR network');
  if (!ethers.isAddress(packet.contract) || !ethers.isAddress(packet.owner)) {
    throw new Error('Invalid QR address');
  }
  const known = deploymentsForChain(chainId).some((d) => d.address.toLowerCase() === packet.contract.toLowerCase());
  if (!known) throw new Error('Unknown ticket contract');
  return { ...packet, tokenId: String(packet.tokenId), chainId };
}

// Some public RPCs reject long historical ranges. Try the fast path first,
// then walk bounded windows without flooding the provider with parallel calls.
export async function queryTicketLogs(contract, filter, startBlock = 0) {
  const head = await contract.runner.provider.getBlockNumber();
  if (startBlock > head) return [];
  try { return await contract.queryFilter(filter, startBlock, head); }
  catch {
    const logs = [];
    for (let from = startBlock; from <= head; from += 9000) {
      logs.push(...await contract.queryFilter(filter, from, Math.min(from + 8999, head)));
    }
    return logs;
  }
}
