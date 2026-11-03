import { ethers } from "ethers";
import dotenv from "dotenv";
import { readDeployment } from "./deploymentConfig.js";
dotenv.config();

async function main() {
  const organizerAddress = process.argv[2] || process.env.ORGANIZER_ADDRESS;
  if (!ethers.isAddress(organizerAddress)) throw new Error('Usage: node scripts/whitelist.js <organizer-wallet-address>');
  const contractAddress = readDeployment('sepolia').address;

  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    console.error("❌ ERROR: SEPOLIA_RPC_URL or DEPLOYER_PRIVATE_KEY is missing in your .env file!");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const abi = [
    "function owner() view returns (address)",
    "function whitelistOrganizer(address organizer) public",
    "function whitelistedOrganizers(address organizer) public view returns (bool)"
  ];

  const contract = new ethers.Contract(contractAddress, abi, wallet);
  if (Number((await provider.getNetwork()).chainId) !== 11155111) throw new Error('The RPC must point to Sepolia.');
  if ((await contract.owner()).toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error('The configured deployer key is not the current contract owner. Use the owner wallet in the Admin Console.');
  }

  console.log(`📡 Checking whitelist status for ${organizerAddress}...`);
  const isAlreadyWhitelisted = await contract.whitelistedOrganizers(organizerAddress);
  if (isAlreadyWhitelisted) {
    console.log(`✅ Already whitelisted!`);
    return;
  }

  console.log(`⏳ Broadcasting whitelist request for: ${organizerAddress} on Sepolia...`);
  const tx = await contract.whitelistOrganizer(organizerAddress);
  
  console.log(`✈️ Transaction hash: ${tx.hash}`);
  console.log("⏳ Waiting for transaction block confirmation...");
  await tx.wait();

  console.log("✅ SUCCESS: Organizer address has been whitelisted on the Sepolia network!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Transaction failed:", error);
    process.exit(1);
  });
