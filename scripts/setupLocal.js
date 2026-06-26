// One-shot local dev setup for TicketChain.
//
// Run after (re)starting the Hardhat node:
//   npx hardhat run scripts/setupLocal.js --network localhost
//
// It will:
//   1. Deploy a fresh TicketContract (Hardhat account 0 = deployer/owner)
//   2. Whitelist the organizer Privy wallet
//   3. Fund the organizer + admin Privy wallets with test ETH (gas)
//   4. Transfer contract ownership to the admin Privy wallet (so the in-app
//      Admin Console can whitelist/approve organizers)
//   5. Auto-update the localhost address in frontend/src/constants.js
//
// Edit the two addresses below to match YOUR Privy embedded wallets.
// (Find them at the top-right of the app after signing in.)

import hre from "hardhat";
import fs from "fs";
import path from "path";

// ── Your Privy embedded wallet addresses (override via env if you like) ───────
const ORGANIZER = process.env.LOCAL_ORGANIZER || "0x29341e403C8978e065a3BbD57520b12649395CC6";
const ADMIN     = process.env.LOCAL_ADMIN     || "0x6eE97e0DFdaf29f365Fa82e26B63388f5748f707";
const FUND_ETH  = "10"; // test ETH to send each wallet for gas

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners(); // Hardhat account 0 = initial owner

  console.log("🚀 Local setup starting...");
  console.log("   Deployer/owner :", deployer.address);
  console.log("   Organizer      :", ORGANIZER);
  console.log("   Admin          :", ADMIN);

  // 1. Deploy
  const TicketContract = await ethers.getContractFactory("TicketContract");
  const contract = await TicketContract.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const deployBlock = (await contract.deploymentTransaction().wait()).blockNumber;
  console.log(`\n✅ Deployed TicketContract -> ${address} (block ${deployBlock})`);

  // 2. Whitelist organizer (deployer is still owner here)
  await (await contract.whitelistOrganizer(ORGANIZER)).wait();
  console.log(`✅ Whitelisted organizer: ${ORGANIZER}`);

  // 3. Fund organizer + admin for gas
  for (const [label, addr] of [["organizer", ORGANIZER], ["admin", ADMIN]]) {
    const bal = await ethers.provider.getBalance(addr);
    if (parseFloat(ethers.formatEther(bal)) < parseFloat(FUND_ETH)) {
      await (await deployer.sendTransaction({ to: addr, value: ethers.parseEther(FUND_ETH) })).wait();
      console.log(`✅ Funded ${label} (${addr}) with ${FUND_ETH} ETH`);
    } else {
      console.log(`ℹ️  ${label} already funded (${ethers.formatEther(bal)} ETH)`);
    }
  }

  // 4. Transfer ownership to admin LAST (whitelist above needed deployer as owner)
  await (await contract.transferOwnership(ADMIN)).wait();
  console.log(`✅ Transferred ownership to admin: ${await contract.owner()}`);

  // 5. Update frontend localhost address
  syncConstants(address, deployBlock);

  console.log("\n🎉 Local setup complete. Hard-refresh the app (Ctrl+Shift+R) and sign in.");
}

function syncConstants(address, deployBlock) {
  const file = path.join(process.cwd(), "frontend", "src", "constants.js");
  let src = fs.readFileSync(file, "utf8");

  // Replace the localhost return line inside getContractAddress()
  const re = /return\s+"0x[0-9a-fA-F]{40}";\s*\/\/\s*Localhost[^\n]*/;
  const replacement = `return "${address}"; // Localhost Hardhat address (auto-set by setupLocal.js, block ${deployBlock})`;

  if (re.test(src)) {
    src = src.replace(re, replacement);
    fs.writeFileSync(file, src);
    console.log(`✅ Updated localhost address in frontend/src/constants.js -> ${address}`);
  } else {
    console.warn(`⚠️  Could not find the localhost address line in constants.js.\n   Manually set the chainId 31337 branch to: ${address}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Local setup failed:", error);
    process.exit(1);
  });
