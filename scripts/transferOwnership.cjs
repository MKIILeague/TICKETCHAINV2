const hre = require("hardhat");

async function main() {
  const { readDeployment } = await import('./deploymentConfig.js');
  const contractAddress = process.env.CONTRACT_ADDRESS || readDeployment(hre.network.name).address;
  const newOwner = process.env.NEW_OWNER;
  if (!hre.ethers.isAddress(newOwner) || newOwner === hre.ethers.ZeroAddress) throw new Error('Set NEW_OWNER to the intended admin wallet address.');

  const TicketContract = await hre.ethers.getContractFactory("TicketContract");
  const contract = await TicketContract.attach(contractAddress);
  const [signer] = await hre.ethers.getSigners();
  if ((await contract.owner()).toLowerCase() !== signer.address.toLowerCase()) throw new Error('The configured signer is not this contract owner.');

  console.log("Transferring ownership to:", newOwner);
  const tx = await contract.transferOwnership(newOwner);
  await tx.wait();
  console.log("Ownership transferred!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
