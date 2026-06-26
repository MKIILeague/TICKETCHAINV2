# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TicketChain V2 is a hybrid decentralized event-ticketing platform. Tickets are ERC-721 NFTs on Ethereum (Hardhat for local dev, Sepolia testnet for live). Users authenticate with **Privy.io** (email/Google/wallet) and get an auto-provisioned embedded wallet — there is no MetaMask requirement for the consumer flow. There are three sub-projects with **separate `package.json` / `node_modules`**:

- **root** — Hardhat project: the Solidity contract, deploy/admin scripts, `hardhat.config.cjs`.
- **`frontend/`** — Vite + React 19 SPA (the actual app). Privy auth, ethers v6, Firestore.
- **`backend/`** — small Express server that verifies Privy JWTs. **Optional/standalone** — the frontend does not call it for the core flow; it's a reference auth-verification service.

## Commands

All commands run from the directory that owns the relevant `package.json`.

```bash
# Local blockchain (root, terminal 1 — leave running)
npx hardhat node

# Deploy contract to local node (root, terminal 2)
npx hardhat run scripts/deploy.js --network localhost

# One-shot local setup: deploy + whitelist + fund + transfer ownership +
# auto-patch the localhost address in frontend/src/constants.js (root)
npx hardhat run scripts/setupLocal.js --network localhost

# Deploy to Sepolia (needs SEPOLIA_RPC_URL + DEPLOYER_PRIVATE_KEY in root .env)
npx hardhat run scripts/deploy.js --network sepolia

# Frontend (frontend/)
npm run dev        # Vite dev server at http://localhost:5173
npm run build      # production build -> frontend/dist
npm run lint       # ESLint
npm run preview    # serve the production build

# Backend (backend/)
npm start          # node server.js
npm run dev        # node --watch server.js

# Firebase Hosting (root) — serves frontend/dist
firebase deploy --only hosting
```

There is **no automated test suite** (no `npm test`, no Hardhat tests). Verification is manual — see `run_guide.md` for the full local and Sepolia walkthroughs.

## After redeploying the contract

The frontend hardcodes the contract address and deployment block in `frontend/src/constants.js`:
- `CONTRACT_ADDRESS` / `START_BLOCK` — the **Sepolia** deployment (used when chainId 11155111).
- `getContractAddress(chainId)` returns the **localhost** address for chainId 31337.

Any deploy prints the new address + block. For Sepolia you must hand-edit `constants.js`; `setupLocal.js` auto-patches only the localhost branch. `START_BLOCK` matters because the marketplace discovers events by querying `TicketMinted` logs from that block — stale values mean missing or slow event lists.

## Architecture

### Roles (`frontend/src/useTicketWallet.js`)
This hook is the single source of truth for identity and role. Role resolution is layered:
- **admin / gatekeeper** — by email allowlist in `ROLE_CONFIG` at the top of the file (synchronous, no flicker). To grant admin, add the email there.
- **organizer** — async: reads `organisers/{walletAddress}` from Firestore; `status === "approved"` makes the user an organizer.
- **buyer** — the default for any other authenticated user.

`roleLoading` guards against premature redirects while the async organizer check runs (see the comments — getting the initial state wrong causes redirect loops). The Firestore read is raced against an 8s timeout so a stalled connection can't spin forever.

### Authority model (important)
Client-side role checks (`RequireRole.jsx`, the navbar) are **UX only**. Real authority is on-chain:
- `onlyOwner` — contract owner can `whitelistOrganizer` / `revokeOrganizer` / `pause`.
- `onlyWhitelistedOrganizer` — gate on `mintTicket` / `batchMintTickets`.

Admin approval is a **two-part action**: write `status:"approved"` to Firestore AND send the on-chain `whitelistOrganizer` tx. Firestore status is just the UI signal; the contract whitelist is the real gate enforced at mint time. The backend `verifyPrivyToken` middleware is the server-side equivalent for the Express service.

### Routing (`frontend/src/App.jsx`)
React Router v7, single `<BrowserRouter>` defined in `App.jsx`. Two route groups:

**Consumer routes** — share `ConsumerLayout` (navbar + footer):
| Path | Component | Notes |
|------|-----------|-------|
| `/` | `BuyerResellerDashboard` (`view="events"`) | Marketplace + landing page. **Public** — viewable logged-out via public RPC, so NOT wrapped in `RequireRole`. |
| `/wallet` | `BuyerResellerDashboard` (`view="wallet"`) | `RequireRole allow={["buyer"]}` |
| `/organizer` | `OrganizerLanding` | Register/login entry chooser. |
| `/organizer/register` | `OrganizerDashboard` (`mode="register"`) | |
| `/organizer/login` | `OrganizerDashboard` (`mode="login"`) | |
| `/admin/login` | `AdminLogin` | Hidden entry, not linked in navbar. |

**Bare full-screen routes** — no consumer navbar:
| Path | Component | Guard |
|------|-----------|-------|
| `/organizer/dashboard` | `OrganizerDashboard` (`mode="dashboard"`) | `allow={["organizer"]}` |
| `/gatekeeper` | `GatekeeperTerminal` | `allow={["gatekeeper"]}` — mobile-gate oriented |
| `/admin/dashboard` | `SystemAdminConsole` | `allow={["admin"]}` |

The page components take `walletAddress / wallet / connectWallet` props (sourced from `useTicketWallet`; `connectWallet` is Privy `login`). `OrganizerDashboard` additionally takes `mode` + `logout / authenticated / ready`.

### On-chain interaction pattern (ethers v6 + Privy)
Every component that touches the chain repeats the same dance (see `BuyerResellerDashboard.jsx`, `OrganizerDashboard.jsx`, `GatekeeperTerminal.jsx`):
1. `await wallet.getEthereumProvider()` → wrap in `ethers.BrowserProvider`.
2. `await wallet.switchChain(targetChainId)` to ensure the embedded wallet is on the right network, then re-fetch the provider.
3. `getContractAddress(chainId)` → `new ethers.Contract(address, CONTRACT_ABI, signer)`.

Read-only marketplace queries can use a public RPC (`PUBLIC_RPC_URL`) or the local node directly. Events are reconstructed from `TicketMinted` logs via `contract.queryFilter`, not stored in a DB. `CONTRACT_ABI` comes from `frontend/src/TicketContract.json` (the compiled artifact, copied into src).

### Contract specifics (`contracts/TicketContract.sol`)
ERC721URIStorage + Ownable + ReentrancyGuard + Pausable. Solidity 0.8.24, `cancun` EVM.
- **110% anti-scalping cap**: `listTicketForResale` reverts if price > `originalPrice * 110 / 100`.
- **Auto-list on mint**: minting sets `isForResale=true` at face value so primary tickets appear in the marketplace immediately (emits both `TicketMinted` and `TicketResaleListed`).
- `batchMintTickets` mints `quantity` tokens in one tx (one wallet approval). The local Hardhat config sets a huge `blockGasLimit` (500M) so large batches fit in a single tx — local dev only.
- Constructor whitelists the deployer and Hardhat account #2 (`0x3C44...`) for easy local testing.
- Verification: `useTicket` flips `isUsed` (the gatekeeper queries live chain state then sends this tx — verification is online-only by design).

### Data storage
- **Firestore** (`frontend/src/firebase.js`, project `ticketchain-1247c`) — only the `organisers/{walletAddress}` collection is actively used (onboarding status). The config is intentionally committed (public Firebase web config). Note: `initializeFirestore` uses `experimentalAutoDetectLongPolling` to survive proxies/VPNs/ad-blockers that stall the default WebChannel transport.
- **On-chain** — ticket state and the canonical event list (via logs).
- IPFS is referenced in the design doc for token metadata/media but is not a hard dependency of the current flow.

## Environment / config notes

- Root `.env` (gitignored): `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY` — only needed for Sepolia deploys/scripts.
- `backend/.env`: `PORT`, `PRIVY_APP_ID`, `PRIVY_JWKS_URI`, `ALLOWED_ORIGINS` (CORS).
- The Privy `appId` is hardcoded in `frontend/src/main.jsx`. Privy only allows the `localhost` origin (not `127.0.0.1`) — `main.jsx` auto-redirects `127.0.0.1`/`[::1]` to `localhost` before React mounts, and a `PrivyErrorBoundary` surfaces origin/403 errors instead of a blank screen.
- Root `package.json` is `"type": "module"`, so the Hardhat config is `hardhat.config.cjs` (CommonJS) deliberately.
- ⚠️ **This repo lives in a OneDrive folder.** OneDrive sync can silently roll individual files back to older versions (it has reverted `frontend/src/App.jsx`, `main.jsx`, and `constants.js` to stale/scaffold versions before — symptoms: the default Vite splash page, a black screen, or missing `constants.js` exports). If the app suddenly breaks without a code change you made, check these files first (`git diff` if versioned, or confirm `App.jsx` still defines the router and `constants.js` still exports `getContractAddress` / `START_BLOCK` / `PUBLIC_RPC_URL`). Pausing OneDrive sync during active development avoids this.

### Frontend source map (`frontend/src/`)
- `App.jsx` — router + `ConsumerLayout` (navbar/footer); `main.jsx` — Privy provider, `127.0.0.1`→`localhost` redirect, `PrivyErrorBoundary`.
- `useTicketWallet.js` — identity/role hook; `orgStatus.js` — shared, cached+deduped `organisers/{address}` reads (8s timeout, stale-while-revalidate).
- Pages: `BuyerResellerDashboard.jsx` (marketplace + wallet), `OrganizerLanding.jsx`, `OrganizerDashboard.jsx`, `GatekeeperTerminal.jsx`, `AdminLogin.jsx`, `SystemAdminConsole.jsx`. `LandingView.jsx` is legacy (state-based `setRole` nav, not wired into the router).
- `RequireRole.jsx` — UX-only route guard; `constants.js` — addresses/ABI/RPC; `firebase.js` — Firestore init.

## Reference docs in repo
- `run_guide.md` — step-by-step local + Sepolia run/test instructions.
- `TicketChain_Development_Phases.md` — the original product/architecture spec (roles, the 110% rule, hybrid storage). Treat it as intent; the code is the source of truth for current behavior.
