import contractJson from "./TicketContract.json";

// ---------------------------------------------------------------------------
// Sepolia (live testnet) deployment.
// CONTRACT_ADDRESS + START_BLOCK are used when the wallet is on chainId 11155111.
// START_BLOCK is the block the contract was deployed at — the marketplace
// discovers events by querying TicketMinted logs from this block, so a stale
// value means missing/slow event lists. Update it after each Sepolia deploy.
// ---------------------------------------------------------------------------
export const CONTRACT_ADDRESS = "0xF7FE8f5f0699672bac953DC91CE36509CEf79b49";
export const START_BLOCK = 11170233; // exact Sepolia deploy block

// Every Sepolia deployment this app has ever pointed at, NEWEST FIRST. When the
// contract is redeployed, tickets minted/bought on the previous contract are
// orphaned (a new contract is a brand-new NFT collection with its own token IDs).
// "Your tickets" scans ALL of these and aggregates ownership, so a ticket bought
// on an older contract still shows up and can still be listed/transferred — the
// per-ticket `contractAddress` is threaded through to the on-chain actions.
// index 0 must stay the current/canonical deployment (== CONTRACT_ADDRESS).
export const SEPOLIA_DEPLOYMENTS = [
  { address: "0xF7FE8f5f0699672bac953DC91CE36509CEf79b49", startBlock: 11170233 }, // current
  { address: "0x97bDBebB67720a52365EF08e412182fDCC3Be06E", startBlock: 11159059 },
  { address: "0x881F6A6Ae4ABdfb5a16cDC56f83fe9DF86F57374", startBlock: 11144309 },
];

// Public read-only RPC for Sepolia (used for logged-out / fallback reads).
// NOTE: must support historical `eth_getLogs` across the deployment's block
// range. publicnode.com is deliberately NOT used here — it rejects historical
// log queries ("archive requests require a personal token"), which silently
// returned zero tickets in "Your tickets". drpc.org serves them fine.
export const PUBLIC_RPC_URL = "https://sepolia.drpc.org";

// Exporting the exact interface layout definitions
export const CONTRACT_ABI = contractJson.abi;

// Returns the contract address for the active network.
// - 31337 (local Hardhat node) -> the local deployment address
// - everything else            -> the Sepolia address above
export function getContractAddress(chainId) {
  if (Number(chainId) === 31337) {
    return "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"; // Localhost Hardhat address (auto-set by setupLocal.js, block 2)
  }
  return CONTRACT_ADDRESS;
}

// The list of {address, startBlock} the wallet should scan for a given chain.
// Localhost has a single ephemeral deployment; Sepolia carries its full history.
export function getDeployments(chainId) {
  if (Number(chainId) === 31337) {
    return [{ address: getContractAddress(31337), startBlock: 0 }];
  }
  return SEPOLIA_DEPLOYMENTS;
}
