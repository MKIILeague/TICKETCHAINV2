# Presentation readiness — 3 November 2026

## Current result

Local source checks pass: 30 contract/mint-integration tests, 49 frontend logic tests, 9 backend
authentication tests, ESLint and the production/PWA build. The frontend serves at
http://localhost:5173, and the optional backend health check responds at port 5000.
The protected backend profile rejects requests without an access token.

Read-only live checks confirm that Pinata authentication and Privy's JWKS endpoint
respond. The configured Sepolia deployment exists, is unpaused, has 500 minted
tickets, and is owned by `0x6eE97e0DFdaf29f365Fa82e26B63388f5748f707`.

**Firestore reads are restored after the user updated the rules.** The new live
check retrieved 11 published events, but none have an upcoming date. Publish a
small future-dated event before rehearsing the storefront and checkout. The initial
permission error came from rules that expired on 21 September 2026.

**The app is not yet verified end to end for the presentation.** The agent did not
change live database rules, deploy a public contract, or submit NFT transactions
or uploads. The user reports that the website account access now works.

Native browser inspection now works. The signed-in normal Chrome window shows
the user's published `SUBANG RUN FESTIVAL` with 50 available tickets. Purchase,
resale and camera scans still require a manual rehearsal.

## Repairs

- Replaced the failing `sepolia.drpc.org` public RPC, which now returns a paid-plan
  error for Sepolia, with a tested Tenderly endpoint. Historical log queries have
  a bounded-window fallback.
- Corrected Privy 3.28 embedded-wallet creation configuration to
  `embeddedWallets.ethereum.createOnLogin`, and recognized Google login emails.
- Prevented stale roles/profile information from crossing account changes;
  staff lookups now time out instead of leaving the role guard spinning forever.
- Reconstructed ownership by replaying transfers in order. Tickets that return
  to a previous owner now appear. Token IDs from different deployments stay
  separate, and actions carry their actual contract address.
- Included older deployments in resale discovery and provenance checks.
- Scanner validates the QR version, network, known contract and live owner;
  check-in targets that exact deployment and checks ownership again before signing.
  Concurrent scan/check-in actions are guarded, and a database failure denies
  validation instead of treating a canceled event as active.
- Primary checkout uses the issuing organizer's remaining stock, with mint block
  and token IDs recorded for newly published events. A confirmed purchase stays
  successful even if its database inventory-counter update fails.
- Event publication uses live gas estimates to split large supplies into capped
  transactions. It checkpoints each batch and its hash, verifies receipts, and
  resumes from confirmed IDs after cancellation or connection loss. Privy embedded
  wallets approve the remaining event supply once per Publish/Resume run; later
  batches continue automatically. Recovery is
  stored in the same browser; storage must be writable before another batch is sent.
- Admin actions check network, contract presence and actual on-chain ownership.
- Corrected backend JWT verification to ES256, matching
  [Privy's access-token specification](https://docs.privy.io/authentication/user-authentication/access-tokens).
- Fixed lint errors and unstable component definitions, and corrected stale
  deployment addresses in helper scripts. Local-only setup scripts reject Sepolia.

## Online event-creation failure and repair

The user's [150-ticket mint transaction](https://sepolia.etherscan.io/tx/0x96f156414080b4d8cfaae899a34f9e067eeec3b54229a72830a12f2737da9df3)
for `SUBANG RUN FESTIVAL` failed with receipt status 0. It requested 22,700,000 gas
and consumed 16,777,216. The organizer was whitelisted, the contract was unpaused,
and the organizer had about 1.47 Sepolia ETH. Read-only replay returned out of gas.
The old fallback guessed 150,000 gas per ticket after estimation failed, while a
current live estimate for one ticket was about 1,060,473 gas.

`mintBatches.js` now estimates one ticket and each candidate batch, includes a 20%
buffer, and keeps the requested limit under the block budget and the
[EIP-7825 transaction cap](https://eips.ethereum.org/EIPS/eip-7825). It never submits
a guessed gas limit when the RPC fails. Read-only validation on the existing
deployment planned 13 tickets with a 15,831,358 gas limit, roughly 12 confirmations
for this 150-ticket event. Every subsequent batch is estimated afresh.

Only fully minted inventory becomes published in Firestore. `Resume publication`
reconciles a pending transaction before sending more; saved IDs prevent reminting
confirmed batches. A wallet submission interrupted before its hash was saved
requires the user to supply that hash, which is checked against the wallet,
contract, event, metadata, price, quantity and nonce. A preparation with no submitted
or confirmed mint can be discarded to edit the draft. Legacy sync-only recovery
records remain supported.

The user chose one publishing confirmation with automatic batches. For Privy
embedded wallets, the first transaction modal explicitly authorizes the event's
remaining ticket supply and explains the gas charged per batch. Later transactions
use Privy's per-action `uiOptions.showWalletUIs: false`, supported by the installed
SDK and [Privy's transaction UI documentation](https://docs.privy.io/recipes/react/manage-wallet-UIs).
Global wallet confirmation settings were not changed. Other transaction flows and
external-wallet fallback retain their existing prompts.

`mintApproval.js` binds that one-run approval to the exact organizer, contract,
network, metadata, event name, price, remaining supply and gas cap. It is held only
in memory; a fresh Resume action requests approval again. A Stop control pauses
after the current submitted batch, with receipts and remaining supply preserved.
SDK recovery or MFA prompts can still occur if required by the wallet. Tests use a
controlled SDK adapter and real local-chain mints; live signing remains a manual
user action.

This repair is frontend-only and works with the existing deployed contract. It
must be committed and deployed to the hosted frontend before it changes the live
website. No public mint transactions were submitted by the agent during testing.

## Older website version retained in an open tab

The user later saw the old “Too many tickets for a single transaction” alert for
50 tickets. A fresh HTTP check of `ticketchainv-2.vercel.app` retrieved the deployed
`index-yEmHx_sy.js` bundle: it contained the new resume/batching flow and did not
contain that alert. The tab was therefore running an older application version.
The existing PWA registration activated updates without notifying or reloading
an already-open page, and its cached navigation shell could retain old HTML.

The frontend now uses an explicit update notice, checks for updates on focus and
periodically, and waits for the user to finish wallet work before choosing reload.
Page navigations use network-first HTML instead of a precached app shell, while
hashed static assets remain cached. Vercel headers prevent caching the HTML and
service-worker registration files. The implementation follows the
[Vite PWA update flow](https://vite-pwa-org.netlify.app/guide/prompt-for-update.html).

An already-open old tab still needs a one-time refresh or close/reopen. A private
window can verify the current deployment without clearing the original browser's
login or mint-recovery records. Never clear local storage to repair a stale page
while a publication may need its saved recovery state.

The first update-button implementation had a reload gap: Workbox's refresh callback
could be missed after manually discovering a waiting worker or after another tab
activated it. Clicking sent a message but did not necessarily reload the page.
`appUpdate.js` listens directly to activation/state/controller events before
sending `SKIP_WAITING` and reloads immediately when no update is waiting. If
activation stalls, it unregisters only this app's worker before reloading;
it does not erase browser storage. It cleans up listeners and reloads at most
once. These paths have focused regression tests based on the
[service-worker activation lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/state).

Native Chrome inspection reproduced an active worker alongside a waiting worker,
then an activated worker with the old timeout notice still visible. A worker
state alone does not establish that a newer application is available. Production
builds now embed an ID and emit `app-version.json`; the notice compares the page's
ID with that uncached deployment file. A waiting worker for the same build does
not announce an update. Failed version checks do not invent a newer version.

Publication activity is tracked through the complete Publish/Resume operation.
The update button is disabled during that work, and activity is checked again
before reloading. Worker activation in another tab never forces a reload here.
The existing login and mint-recovery storage are not cleared by an app update.

## Updated contract versus existing Sepolia contracts

`contracts/TicketContract.sol` now rejects accidental ETH payments, self-purchases,
duplicate/unavailable batch items, nonexistent check-ins and unauthorized check-in
callers. Gift transfers clear old resale listings; used tickets cannot move; pause
also blocks standard ERC-721 transfers. A no-op refund placeholder now explicitly
rejects the unsupported operation.

Only the contract owner, the still-whitelisted issuing organizer, and wallets
authorized with `setGatekeeper(address,bool)` can check in on a **new deployment**.
The Admin Console includes grant/revoke controls and detects legacy deployments.

These are **source/local-test improvements**. The already-deployed Sepolia bytecode
is immutable and retains its old permission/payment/transfer behavior. Its 500
tickets were not migrated. Deploy the updated contract for the new protections;
retaining an old deployment in history also retains that deployment's limitations.
The frontend cancels an old listing before a gift transfer as a compatibility measure.

## Firestore recovery

The current app uses Privy authentication but does not sign into Firebase Auth.
Consequently, simply changing the rules to `request.auth != null` breaks its reads
and writes too.

[firestore-demo.rules](firestore-demo.rules) is an optional, explicitly public demo
configuration for `events`, `organisers`, `staff`, and `profiles`. It permits reads
and writes until **5 November 2026 at 00:00 UTC / 08:00 Malaysia time**. Anyone with
the public project configuration can read/change these records until expiry.
Apply it only to disposable demo data, through Firebase Console → Firestore
Database → Rules → Publish. It was not deployed by the agent and is not
referenced by `firebase.json`. Set a suitable short expiry if rehearsing later.

A permanent setup should verify the Privy token on a trusted backend, issue a
Firebase custom token, sign the client into Firebase, and enforce user/role rules.
Service-account credentials must stay on the backend. Do not expose real user
profiles or organizer applications under public demo rules.

The existing `VITE_PINATA_JWT` upload design also puts that token in the browser
bundle. Use a restricted demo token; a permanent deployment should proxy uploads
through an authenticated backend rather than distribute a Pinata credential.

After restoring access, run `npm run check:live`. If it reports no upcoming events,
publish a small future-dated event for the presentation; past events are intentionally
hidden from the live storefront.

## Architecture and important limits

| Part | Responsibility |
| --- | --- |
| `contracts/TicketContract.sol` | NFT ownership, face/resale prices, 110% resale cap, whitelist, pause, used state |
| `frontend/src/main.jsx` | Privy provider and Sepolia wallet configuration |
| `frontend/src/useTicketWallet.js` | Session identity and UI roles |
| `frontend/src/App.jsx` | Consumer, organizer, gatekeeper and admin routes |
| `frontend/src/EventWizard.jsx` | Draft → IPFS → mint → publish, with publication recovery |
| `frontend/src/EventCheckout.jsx` | Primary inventory purchase and sold-counter synchronization |
| `frontend/src/BuyerResellerDashboard.jsx` | Wallet, QR tickets, resale, transfers |
| `frontend/src/ResaleMarketplace.jsx` | Peer listings and ownership/provenance inspection |
| `frontend/src/GatekeeperTerminal.jsx` | Live verification and used-ticket transaction |
| `frontend/src/SystemAdminConsole.jsx` | Organizer approval/whitelist, pause, staff-wallet authorization |
| Firestore | `events`, `organisers`, `staff`, `profiles` |
| IPFS / Pinata | Poster and ERC-721 metadata storage |
| `backend/` | Optional token-verification API; not required by the main UI |

Event cancellation and event dates are enforced by the application, not by the
current contract. Cancellation does not refund simulated payments. RM uses a fixed
display rate, not a live exchange rate. An unused QR is a bearer identifier: an
exact copy can be presented before first entry; live owner/used checks reject stale
owners and repeat entry, not every possible screenshot. Internet access is required.

Scope of review: application source, contract, tests, scripts, configuration and run
documentation. Dependencies/generated output and private academic report backups
were not treated as application source. Existing environment credentials were not
changed or printed.
