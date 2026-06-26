import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  // Get recipient address from the command-line argument
  const recipient = process.argv[2];

  if (!recipient || !ethers.isAddress(recipient)) {
    console.error("❌ ERROR: Please provide a valid recipient address.\n\nUsage: nodagye scripts/send_eth.js <YOUR_WALLET_ADDRESS>\nExample: node scripts/send_eth.js 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
    process.exit(1);
  }

  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    console.error("❌ ERROR: SEPOLIA_RPC_URL or DEPLOYER_PRIVATE_KEY is missing in your .env file!");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const balance = await provider.getBalance(wallet.address);
  console.log(`🏦 Deployer Account: ${wallet.address}`);
  console.log(`💰 Deployer Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error("❌ ERROR: Deployer account has 0 balance.");
    process.exit(1);
  }

  const amountInEther = process.argv[3] || "0.0025";
  console.log(`⏳ Transferring ${amountInEther} Sepolia ETH to ${recipient}...`);
  
  const tx = await wallet.sendTransaction({
    to: recipient,
    value: ethers.parseEther(amountInEther)
  });

  console.log(`✈️ Transaction hash: ${tx.hash}`);
  console.log("⏳ Waiting for transaction confirmation...");
  await tx.wait();

  console.log(`✅ SUCCESS: Transferred ${amountInEther} Sepolia ETH to ${recipient}!`);
}

main().catch((error) => {
  console.error("💥 Transfer failed:", error);
  process.exit(1);
});
