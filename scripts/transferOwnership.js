import hre from "hardhat";
import dotenv from "dotenv";
dotenv.config();

const CONTRACT_ADDRESS = "0x860f39a8cBd0430ed4aCC28EC37477906dEA551a";
const NEW_OWNER = "0x6eE97e0DFdaf29f365Fa82e26B63388f5748f707";

async function main() {
  console.log("🔑 Transferring contract ownership on Sepolia...");
  console.log(`   Contract : ${CONTRACT_ADDRESS}`);
  console.log(`   New Owner: ${NEW_OWNER}`);

  const TicketContract = await hre.ethers.getContractAt("TicketContract", CONTRACT_ADDRESS);
  
  const tx = await TicketContract.transferOwnership(NEW_OWNER);
  console.log(`\n⏳ Transaction sent: ${tx.hash}`);
  console.log("   Waiting for confirmation...");
  
  await tx.wait();
  console.log("\n✅ SUCCESS! Ownership transferred.");
  console.log(`   ${NEW_OWNER} is now the contract owner.`);
  console.log("   You can now whitelist organizers directly from the Admin Console.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Transfer failed:", error);
    process.exit(1);
  });
