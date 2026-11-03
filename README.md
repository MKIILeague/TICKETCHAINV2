# TicketChain V2

Final year project: event tickets represented by ERC-721 NFTs, a React storefront,
Privy email/Google sign-in with embedded Ethereum wallets, Firestore event records,
and IPFS posters/metadata. The optional Express service verifies Privy access tokens.

The presentation uses **Sepolia and simulated payments**. Purchases transfer NFTs
with zero ETH as ticket payment; each signer still needs Sepolia test ETH for gas.
Displayed ETH/RM prices are ledger values, not collected payments.

Start the app from the project root:

```sh
npm run dev
```

Open **http://localhost:5173**. The main app does not need the Express server or a
local Hardhat node. Installed dependencies are already present in this workspace.
For a fresh machine, run `npm ci` in the root, `frontend`, and `backend` directories.
Use a Node version meeting the installed Vite requirement (22.12+); this workspace
was checked with Node 26.2.0.

```sh
npm run check        # contract tests, frontend tests, lint/build, backend tests
npm run check:live   # READ-ONLY Pinata, Privy, Sepolia and Firestore checks
```

See [run_guide.md](run_guide.md) for setup, rehearsal and contract deployment steps.
[docs/PRESENTATION_STATUS.md](docs/PRESENTATION_STATUS.md) records the repair work,
verified results, remaining live blockers and the project architecture.

Do not publish `.env` files. The public Firebase/Privy identifiers are not server
credentials; their presence in the app does not provide database authorization.
