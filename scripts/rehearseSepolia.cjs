// Exercises a LOCAL FORK of the deployed Sepolia contract. It never broadcasts
// to Sepolia, uses no private keys, and refuses any non-Hardhat network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ethers, network } = require('hardhat');

async function main() {
  if (network.name !== 'hardhat' || Number((await ethers.provider.getNetwork()).chainId) !== 31337) {
    throw new Error('This rehearsal only runs on the in-memory Hardhat network.');
  }
  const source = fs.readFileSync('frontend/src/constants.js', 'utf8');
  const address = source.match(/export const CONTRACT_ADDRESS = "([^"]+)"/)[1];
  const rpc = source.match(/export const PUBLIC_RPC_URL = "([^"]+)"/)[1];
  const abi = JSON.parse(fs.readFileSync('frontend/src/TicketContract.json')).abi;
  await network.provider.send('hardhat_reset', [{ forking: { jsonRpcUrl: rpc } }]);
  await network.provider.send('evm_setBlockGasLimit', [ethers.toBeHex(16_777_216)]);
  console.log('Local fork loaded; exercising deployed contract through the repaired wallet RPC adapter.');
  const { routeWalletRpc } = await import('../frontend/src/walletRpc.js');
  const { ticketIssuers, isPrimaryInventory, ownedTokenIds } = await import('../frontend/src/ticketUtils.js');
  const readAdapter = { send: (method, params) => network.provider.send(method, params) };
  let readRequests = 0, signatures = 0;
  const makeWallet = async (address) => {
    await network.provider.send('hardhat_impersonateAccount', [address]);
    await network.provider.send('hardhat_setBalance', [address, ethers.toBeHex(ethers.parseEther('10'))]);
    const wallet = {
      request: ({ method, params }) => {
        if (method === 'eth_chainId') return network.provider.send(method, []);
        if (method === 'eth_accounts') return Promise.resolve([address]);
        if (method === 'eth_sendTransaction') {
          assert.equal(params[0].from.toLowerCase(), address.toLowerCase());
          signatures++; return network.provider.send(method, params);
        }
        throw new Error(`Simulated broken Privy RPC: ${method}`);
      },
    };
    const provider = new ethers.BrowserProvider(routeWalletRpc(wallet, {
      allowLocal: true,
      readProviderFor: () => ({ send: (...args) => { readRequests++; return readAdapter.send(...args); } }),
    }));
    provider.pollingInterval = 100;
    return { provider, signer: await provider.getSigner(address) };
  };
  const c = new ethers.Contract(address, abi, ethers.provider);
  const owner = await c.owner();
  const latest = await c.getNextTicketId();
  const startBlock = Number(source.match(/export const START_BLOCK = (\d+)/)[1]);
  const mintLogs = await c.queryFilter(c.filters.TicketMinted(latest), startBlock);
  assert.ok(mintLogs.length, 'Latest live ticket must have a mint log');
  const issuer = mintLogs.at(-1).args[1];
  const [firstBuyer, secondBuyer] = await ethers.getSigners();
  const ownerWallet = await makeWallet(owner);
  const issuerWallet = await makeWallet(issuer);
  const buyerWallet = await makeWallet(firstBuyer.address);
  const secondWallet = await makeWallet(secondBuyer.address);
  const admin = c.connect(ownerWallet.signer);
  const organizer = c.connect(issuerWallet.signer);
  const buyer = c.connect(buyerWallet.signer);
  const nextBuyer = c.connect(secondWallet.signer);
  const send = async (promise) => {
    const tx = await promise;
    const receipt = await tx.wait(1, 30_000);
    assert.equal(receipt.status, 1);
    console.log(`Confirmed local transaction ${signatures}`);
    return receipt;
  };
  const checks = [];
  if (await c.paused()) await send(admin.unpause());
  assert.equal(await c.whitelistedOrganizers(issuer), true);
  const price = ethers.parseEther('0.0005');
  const first = latest + 1n;
  await send(organizer.batchMintTickets(issuer, 'ipfs://local-fork-rehearsal', price, 'LOCAL FORK ONLY', 4));
  checks.push('organizer publication on the actual deployed bytecode');
  await send(buyer.purchaseResaleTicket(first, { value: 0n }));
  assert.equal(await c.ownerOf(first), firstBuyer.address);
  await send(buyer.batchPurchaseResale([first + 1n, first + 2n], { value: 0n }));
  assert.equal(await c.ownerOf(first + 2n), firstBuyer.address);
  checks.push('single and batch primary purchases with zero ticket payment');
  await send(buyer.listTicketForResale(first, price * 110n / 100n));
  await assert.rejects(buyer.listTicketForResale.estimateGas(first, price * 120n / 100n));
  await send(buyer.cancelResaleListing(first));
  assert.equal((await c.getTicketDetails(first)).isForResale, false);
  await send(buyer.listTicketForResale(first, price));
  await send(nextBuyer.purchaseResaleTicket(first, { value: 0n }));
  assert.equal(await c.ownerOf(first), secondBuyer.address);
  checks.push('user listing, 110% cap, cancellation, peer purchase and ownership');
  // Whitelisting a buyer must not hide tickets they bought from another issuer.
  await send(admin.whitelistOrganizer(secondBuyer.address));
  await send(nextBuyer.listTicketForResale(first, price));
  const logs = await c.queryFilter(c.filters.TicketMinted(first));
  const issuers = ticketIssuers(logs);
  assert.equal(isPrimaryInventory(first, issuer, issuers), true);
  assert.equal(isPrimaryInventory(first, secondBuyer.address, issuers), false);
  checks.push('resale remains visible when its seller is also an organizer');
  // Compatibility with legacy contracts: delist before gifting.
  await send(nextBuyer.cancelResaleListing(first));
  await send(nextBuyer.safeTransferFrom(secondBuyer.address, firstBuyer.address, first));
  assert.equal(await c.ownerOf(first), firstBuyer.address);
  assert.equal((await c.getTicketDetails(first)).isForResale, false);
  const incoming = await c.queryFilter(c.filters.Transfer(null, firstBuyer.address));
  const outgoing = await c.queryFilter(c.filters.Transfer(firstBuyer.address, null));
  assert.ok(ownedTokenIds(incoming, outgoing, firstBuyer.address).includes(String(first)));
  checks.push('gift transfer and ownership replay after a returned ticket');
  await send(admin.pause());
  await assert.rejects(buyer.purchaseResaleTicket.estimateGas(first + 3n));
  await assert.rejects(buyer.whitelistOrganizer.estimateGas(secondBuyer.address));
  await send(admin.unpause());
  await send(admin.revokeOrganizer(secondBuyer.address));
  assert.equal(await c.whitelistedOrganizers(secondBuyer.address), false);
  checks.push('owner approval/revocation, pause/resume and unauthorized-admin rejection');
  let gatekeeperAuthorization = true;
  try { await c.gatekeepers(owner); } catch { gatekeeperAuthorization = false; }
  await send(admin.useTicket(first));
  assert.equal((await c.getTicketDetails(first)).isUsed, true);
  checks.push('owner check-in');
  console.log(JSON.stringify({
    environment: 'LOCAL FORK; no Sepolia writes', contract: address, owner,
    forkedLiveSupply: String(latest), checks, readRequests, signatures,
    gatekeeperAuthorization,
    limitations: gatekeeperAuthorization ? [] : ['Legacy deployment does not implement gatekeeper wallet authorization'],
  }, null, 2));
  await Promise.all([ownerWallet, issuerWallet, buyerWallet, secondWallet].map((w) => w.provider.destroy()));
}
main().catch((error) => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
