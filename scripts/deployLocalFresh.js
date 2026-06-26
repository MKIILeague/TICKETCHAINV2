// Fresh local deploy + sync constants.js (keeps deployer/account0 as owner so
// we can whitelist your Privy wallet afterwards without a redeploy).
// Run: npx hardhat run scripts/deployLocalFresh.js --network localhost
import hre from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  console.log("🚀 Deploying fresh TicketContract to localhost...");
  console.log("   Deployer/owner:", deployer.address);

  const TicketContract = await ethers.getContractFactory("TicketContract");
  const contract = await TicketContract.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const deployBlock = (await contract.deploymentTransaction().wait()).blockNumber;
  console.log(`\n✅ Deployed -> ${address} (block ${deployBlock})`);
  console.log(`   Owner: ${await contract.owner()}`);

  // Sync localhost address in frontend/src/constants.js
  const file = path.join(process.cwd(), "frontend", "src", "constants.js");
  let src = fs.readFileSync(file, "utf8");
  const re = /return\s+"0x[0-9a-fA-F]{40}";\s*\/\/\s*Localhost[^\n]*/;
  const replacement = `return "${address}"; // Localhost Hardhat address (auto-set, block ${deployBlock})`;
  if (re.test(src)) {
    fs.writeFileSync(file, src.replace(re, replacement));
    console.log(`✅ Updated constants.js localhost address -> ${address}`);
  } else {
    console.warn(`⚠️  Could not find localhost address line in constants.js. Set chainId 31337 branch to: ${address}`);
  }
  console.log("\n🎉 Done. Next: give me your Privy wallet address to whitelist + fund it.");
}

main().then(() => process.exit(0)).catch((e) => { console.error("💥 Deploy failed:", e); process.exit(1); });
