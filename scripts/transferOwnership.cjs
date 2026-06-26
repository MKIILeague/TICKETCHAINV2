const hre = require("hardhat");

async function main() {
  const contractAddress = "0x881F6A6Ae4ABdfb5a16cDC56f83fe9DF86F57374";
  const newOwner = "0x6eE97e0DFdaf29f365Fa82e26B63388f5748f707";

  const TicketContract = await hre.ethers.getContractFactory("TicketContract");
  const contract = await TicketContract.attach(contractAddress);

  console.log("Transferring ownership to:", newOwner);
  const tx = await contract.transferOwnership(newOwner);
  await tx.wait();
  console.log("Ownership transferred!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
