import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const organizerAddress = "0x29341e403C8978e065a3BbD57520b12649395CC6";
  const contractAddress = "0xbbfCDf66052abE994712589336aaEee4F4825CEC";

  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    console.error("❌ ERROR: SEPOLIA_RPC_URL or DEPLOYER_PRIVATE_KEY is missing in your .env file!");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const abi = [
    "function whitelistOrganizer(address organizer) public",
    "function whitelistedOrganizers(address organizer) public view returns (bool)"
  ];

  const contract = new ethers.Contract(contractAddress, abi, wallet);

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
