# TicketChain V2: Step-by-Step Run Guide

This guide will walk you through launching the local Hardhat development blockchain, compiling and deploying the smart contracts, and running the Vite-powered React frontend.

---

## 📋 Prerequisites
Ensure you have the following installed on your system:
- **Node.js** (v18 or higher recommended)
- **NPM** (packaged with Node.js)

---

## 🚀 Step-by-Step Setup & Run Instructions

### Step 1: Start the Local Hardhat Node
Before running the frontend, you need a local Ethereum blockchain simulator running.
1. Open a terminal at the root of the project (`TicketchainV2`).
2. Run the following command:
   ```bash
   npx hardhat node
   ```
3. **What this does:** This starts a local Ethereum network on `http://127.0.0.1:8545` and prints out 20 test accounts with private keys, pre-funded with 10,000 fake ETH each. Leave this terminal open.

---

### Step 2: Deploy the Smart Contract
Now you need to deploy the TicketChain contract to the running local node.
1. Open a second terminal window or tab at the root of the project.
2. Run the deployment script:
   ```bash
   npx hardhat run scripts/deploy.js --network localhost
   ```
3. **What this does:** It compiles the solidity contract (`TicketContract.sol`) and deploys it to your running local node. You will see an output like:
   ```text
   🚀 Starting TicketChain Smart Contract Deployment...
   ✅ SUCCESS: TicketChain contract successfully deployed to: 0x8C1A9cdB6E1C1F2767e41C11A5a725be8B7cC97f
   ```

---

### Step 3: Verify the Contract Address
The frontend must point to the exact contract address that was deployed.
1. Locate the printed address from the terminal output in Step 2 (typically `0x8C1A9cdB6E1C1F2767e41C11A5a725be8B7cC97f`).
2. Open the file [frontend/src/constants.js](file:///C:/Users/syeda/OneDrive/Desktop/TicketchainV2/frontend/src/constants.js).
3. Verify that the `CONTRACT_ADDRESS` constant matches the deployed address:
   ```javascript
   export const CONTRACT_ADDRESS = "0x8C1A9cdB6E1C1F2767e41C11A5a725be8B7cC97f";
   ```
   *(If the address printed is different, update the string inside the double quotes and save the file).*

---

### Step 4: Start the Frontend Application
Now start the development web server for the React interface.
1. Navigate to the `frontend` folder in your terminal:
   ```bash
   cd frontend
   ```
2. Start the Vite dev server:
   ```bash
   npm run dev
   ```
3. **What this does:** This compiles and serves the application locally. In your terminal, you will see the URL (typically `http://localhost:5173/`).
4. Open your browser and navigate to:
   👉 **[http://localhost:5173/](http://localhost:5173/)**

---

## 👥 How to Test on Sepolia (No MetaMask or CLI Required)

Since you are testing on the **Sepolia Testnet** using **Privy Embedded Wallets** funded via the **Google Cloud Faucet**, you can perform the entire flow directly in your web browser:

---

### Step A: Log In and Get Your Privy Wallet Address
1. Go to **[http://localhost:5173/](http://localhost:5173/)** and click **Sign In**.
2. Log in using your email address or Google account.
3. Once authenticated, look at the top right of the navigation bar. You will see your newly generated Privy embedded wallet address (e.g. `0x123...456`).
4. Click on your address or copy it from the screen.

---

### Step B: Fund Your Wallet via Google Cloud Faucet
1. Navigate to the **[Google Cloud Web3 Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)** (or any Sepolia faucet).
2. Paste your copied Privy wallet address and request test Sepolia ETH.
3. Wait for the transaction to complete so that your Privy embedded wallet is funded.

---

### Step C: Register as an Organiser
1. In the app navigation bar, click **Organizer Mode**.
2. Fill out the **Organiser Registration Form** (submit name, email, etc.) and click **Submit Application**.
3. Your screen will transition to the **Pending Screen** because your address is not yet whitelisted on the smart contract.
4. **Log Out** of your organiser account.

---

### Step D: Approve the Application in the Admin Console
1. Click **Sign In** and log in with your Admin email address (e.g., **`syeda@example.com`** or **`admin@ticketchain.io`**).
   *(Ensure you request test Sepolia ETH for this Admin account's Privy wallet too, so it has gas to send the transaction!)*
2. In the navbar, click **Admin Console**.
3. Under the **Organizer Whitelist** tab, you will see your pending registration application.
4. Click **APPROVE** and click **Confirm** in the Privy popup window.
5. **Log Out** of the Admin account.

---

### Step E: Batch-Mint Tickets!
1. Sign in back to your **Organiser Account**.
2. Go to **Organizer Mode** in the navbar.
3. Your application is now approved on-chain! You will see the **Verified** status and the **Primary Ticket Issuance Hub** form.
4. Fill in the event details (e.g., Max Supply `2`) and click **Trigger mintTicket()**. Privy will sign the transaction on Sepolia using your embedded wallet, and the tickets will be minted successfully!


