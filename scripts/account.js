import hre from "hardhat";

// Prints the deployer account address + balance for the selected network.
// Usage: npx hardhat run scripts/account.js --network sepolia
async function main() {
  const [signer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(signer.address);
  const net = await hre.ethers.provider.getNetwork();

  console.log(`Network : ${net.name} (chainId ${net.chainId})`);
  console.log(`Deployer: ${signer.address}`);
  console.log(`Balance : ${hre.ethers.formatEther(balance)} ETH`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
