import hre from "hardhat";
import dotenv from "dotenv";
dotenv.config();

const ADMIN_WALLET = "0x6eE97e0DFdaf29f365Fa82e26B63388f5748f707";
const AMOUNT = "0.03"; // 0.03 Sepolia ETH - enough for many transactions

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`💸 Sending ${AMOUNT} Sepolia ETH to admin wallet...`);
  console.log(`   From: ${deployer.address}`);
  console.log(`   To  : ${ADMIN_WALLET}`);

  const tx = await deployer.sendTransaction({
    to: ADMIN_WALLET,
    value: hre.ethers.parseEther(AMOUNT),
  });

  console.log(`\n⏳ Transaction sent: ${tx.hash}`);
  await tx.wait();
  console.log(`\n✅ Done! Admin wallet now has ${AMOUNT} Sepolia ETH for gas.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Failed:", error);
    process.exit(1);
  });
