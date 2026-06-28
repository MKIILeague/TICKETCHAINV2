import contractJson from "./TicketContract.json";

// ---------------------------------------------------------------------------
// Sepolia (live testnet) deployment.
// CONTRACT_ADDRESS + START_BLOCK are used when the wallet is on chainId 11155111.
// START_BLOCK is the block the contract was deployed at — the marketplace
// discovers events by querying TicketMinted logs from this block, so a stale
// value means missing/slow event lists. Update it after each Sepolia deploy.
// ---------------------------------------------------------------------------
export const CONTRACT_ADDRESS = "0x97bDBebB67720a52365EF08e412182fDCC3Be06E";
export const START_BLOCK = 11159059; // exact Sepolia deploy block

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
    return "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Localhost Hardhat address (auto-set by setupLocal.js, block 1)
  }
  return CONTRACT_ADDRESS;
}
