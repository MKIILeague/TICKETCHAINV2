import hre from "hardhat";

async function main() {
  console.log("🚀 Starting TicketChain Smart Contract Deployment...");

  // Get the contract factory (Make sure the name inside matches your exact .sol contract class name)
  const TicketContract = await hre.ethers.getContractFactory("TicketContract");
  
  // Deploy the contract instance
  const ticketContract = await TicketContract.deploy();

  // Wait for the deployment transaction to be mined onto the local blockchain node
  await ticketContract.waitForDeployment();

  const contractAddress = await ticketContract.getAddress();
  console.log(`\n✅ SUCCESS: TicketChain contract successfully deployed to: ${contractAddress}`);

  // Print the deployment block so the frontend can set START_BLOCK for log queries
  const deployTx = ticketContract.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;
  const deployBlock = receipt ? receipt.blockNumber : await hre.ethers.provider.getBlockNumber();
  console.log(`📦 Deployment block: ${deployBlock}`);
  console.log(`\n👉 Update frontend/src/constants.js:`);
  console.log(`   CONTRACT_ADDRESS = "${contractAddress}"`);
  console.log(`   START_BLOCK = ${deployBlock}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Deployment failed with error:", error);
    process.exit(1);
  });