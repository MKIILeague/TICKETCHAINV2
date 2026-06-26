import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const contractAddress = "0x8C1A9cdB6E1C1F2767e41C11A5a725be8B7cC97f";
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    console.error("Missing SEPOLIA_RPC_URL");
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  // We can search for the transaction block by scanning or binary search, 
  // or we can just query the transaction count/history, or check a safe starting block.
  // Let's check current block first.
  const currentBlock = await provider.getBlockNumber();
  console.log("Current block number on Sepolia:", currentBlock);
  
  // Let's try to query TicketMinted logs with different block ranges
  // to see when the first logs appeared, or if it errors out when querying from 0.
  try {
    const filter = {
      address: contractAddress,
      topics: [ethers.id("TicketMinted(uint256,address,uint256,string)")]
    };
    
    // Try to query from block 0
    console.log("Attempting to query logs from block 0...");
    const logs = await provider.getLogs({
      ...filter,
      fromBlock: 0
    });
    console.log("Found", logs.length, "logs querying from block 0.");
    if (logs.length > 0) {
      console.log("First log block:", logs[0].blockNumber);
    }
  } catch (err) {
    console.error("Error querying from block 0:", err.message);
  }
}

main().catch(console.error);
