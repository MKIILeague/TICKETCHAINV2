import { queryTicketLogs } from './ticketUtils.js';

// Recent publications save exact token IDs. Older events use their issuer's
// mint logs. Only read until the requested primary stock has been found.
export async function findPrimaryTickets(contract, event, { buyer, quantity, startBlock = 0 }) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Enter a valid ticket quantity.');
  if (!event.organiserId) throw new Error('This event is missing its issuing organizer.');
  if (buyer?.toLowerCase() === event.organiserId.toLowerCase()) throw new Error('Use a different buyer account to purchase your organizer inventory.');
  const name = (event.headline || '').trim();
  let ids = event.ticketIds;
  if (!Array.isArray(ids) || !ids.length) {
    const logs = await queryTicketLogs(contract, contract.filters.TicketMinted(null, event.organiserId), startBlock);
    ids = logs.filter((log) => (log.args[3] || '').trim() === name).map((log) => String(log.args[0]));
  }
  const tickets = [];
  for (const id of new Set(ids.map(String))) {
    if (!/^\d+$/.test(id) || BigInt(id) <= 0n) throw new Error('This event contains an invalid ticket ID.');
    const details = await contract.getTicketDetails(id);
    if ((details.eventName || '').trim() !== name || details.isUsed || !details.isForResale) continue;
    const owner = await contract.ownerOf(id);
    if (owner.toLowerCase() !== event.organiserId.toLowerCase()) continue;
    if (event.ipfsHash && await contract.tokenURI(id) !== 'ipfs://' + event.ipfsHash) continue;
    tickets.push({ id, price: details.resalePrice });
    if (tickets.length === quantity) break;
  }
  return tickets;
}
