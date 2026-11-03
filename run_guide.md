# TicketChain: presentation run guide

The chosen presentation setup is **Sepolia with simulated ticket payments**.
NFT ownership and transaction gas are real testnet operations. Ticket prices are
ledger values; purchases send zero ETH as payment.

## Start

From the project root:

```sh
npm run dev
```

Open **http://localhost:5173**. Leave the terminal open. The core application does
not need the Express server or a local Hardhat blockchain. Use localhost rather
than 127.0.0.1 for Privy's allowed-origin configuration.

Dependencies are already installed here. On a fresh machine, install Node 22.12+
and run `npm ci` in the root, `frontend`, and `backend` directories. Avoid updating
packages immediately before the presentation; use the lockfiles.

## Configuration and live checks

- `frontend/.env`: `VITE_PINATA_JWT` for poster and metadata uploads. Restart Vite
  after changing it. The existing key passed a read-only authentication check.
- Root `.env`: `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY`, needed only for
  deployment/admin helper scripts. Never share or commit the private key.
- `frontend/src/constants.js`: canonical contract, deployment block, history and
  public RPC. The old drpc free endpoint no longer serves Sepolia; it was replaced.
- `frontend/src/useTicketWallet.js`: admin/gatekeeper email allowlists. Google
  sign-in emails are recognized. An admin email is a UI role; contract ownership
  still determines who can whitelist or pause.
- Privy dashboard: allow the exact origin you will present from.

Run the non-mutating service check:

```sh
npm run check:live
```

It checks Pinata credentials, Privy verification keys, the current Sepolia contract
and published future events in Firestore. It does not upload, deploy or sign.

The supplied Firestore rules expired on **21 September 2026**. Until rules are
restored, applications/events/profiles/staff cannot work. See
[the status report](docs/PRESENTATION_STATUS.md#firestore-recovery) and the optional
[short-lived demo rules](docs/firestore-demo.rules). Those rules permit public
reads and writes; use them only with disposable demo data. They expire on
5 November 2026 at 08:00 Malaysia time. No cloud rules were automatically changed.

## Rehearse the complete flow

Use separate admin, organizer and buyer accounts. Sign in with the same method
when returning to each account so the wallet remains consistent. Each wallet
sending transactions needs Sepolia test ETH for gas, including gate staff.

1. Open `/organizer`, sign in and submit an organizer application.
2. Sign into the configured admin account at `/admin/login`. Its wallet must own
   the active contract. Approve the application on-chain and in Firestore.
3. Return to the organizer. Create an event with a unique title, a future date,
   poster, small quantity (for example 5) and a nominal price (for example 0.001 ETH).
   Save a draft, preview, then publish. Wait for the wallet confirmation and receipt.
4. If minting succeeds but publishing fails, use **Retry publication**. Keep that
   browser open; recovery data is also saved there when local storage is available.
   Do not mint another batch to repair the database write.
5. Sign into a buyer account. Open the event and buy two tickets. Confirm one
   combined transaction on supported deployments. Verify both tickets in `/wallet`.
6. Open a ticket and view the QR. List one at 0.0011 ETH (110% of a 0.001 ETH face
   value). An attempted 0.0012 ETH listing should be rejected. From a different
   buyer account, purchase the listed token at `/resale`.
7. Transfer the other unused ticket to a different wallet and verify both wallets.
   A listed gift is canceled before transfer on legacy contracts; this can require
   two wallet confirmations. Sending it back should make it reappear correctly.
8. Add a staff email under Organizer -> Staff. On an updated contract, the admin
   must also authorize that staff wallet in **Gatekeeper authorization**. Sign into
   the staff account, open `/gatekeeper`, scan the buyer's current QR and record entry.
   Manual token-ID entry targets the canonical deployment; use QR for older contracts.
9. Scan the used ticket again and verify entry is denied. A QR showing a previous
   owner should also be denied. An exact copy of an UNUSED QR is still a bearer
   identifier, so keep it private until entry.
10. Rehearse cancellation and pause separately. Cancellation is an application-level
    freeze and does not issue refunds. Resume the protocol before the main demo.

Check that older events did not simply expire while the project was inactive.
Finished events move out of the live storefront; publish a future event to present.
A phone camera demo requires an accessible HTTPS deployment and manual camera
permission. Localhost refers to the device running the browser.

## Automated checks

```sh
npm run check
```

This runs contract tests, frontend logic tests, lint, production/PWA build and
backend auth tests. Individual commands:

```sh
npm test
npm test --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
npm test --prefix backend
```

Bundler annotation warnings originate in installed dependencies. They did not
prevent the production/PWA build during this review.

The optional backend can be run separately:

```sh
npm start --prefix backend
```

Check `http://localhost:5000/api/health`. `/api/user/profile` needs a current Privy
ES256 access token and returns 401 without one. The main frontend does not call
this API for its core workflows.

## Updated contract deployment (separate public-chain action)

The repaired source has new check-in authorization and transfer/payment safeguards.
**The existing Sepolia contract has not changed.** A new deployment creates a new
NFT collection; the existing 500 tickets remain in their original contract.
Deploy only when you intend to make this change and have funded the testnet signer.

```sh
npx hardhat run scripts/deploy.js --network sepolia
npm run contract:sync
```

Record the printed address and deployment block. In `frontend/src/constants.js`,
update `CONTRACT_ADDRESS` and `START_BLOCK`, prepend the new entry to
`SEPOLIA_DEPLOYMENTS`, and preserve the older entries. Use the new address for the
ownership transfer; do not accidentally transfer an old deployment:

```powershell
$env:CONTRACT_ADDRESS = "0xNEW_DEPLOYMENT_ADDRESS"
$env:NEW_OWNER = "0xADMIN_PRIVY_WALLET_ADDRESS"
npx hardhat run scripts/transferOwnership.cjs --network sepolia
```

Then use the admin owner's wallet to sync organizer whitelists on the NEW contract
and authorize gatekeeper wallets. Firestore approval from an old deployment alone
does not grant minting rights on a new one. Publish a fresh future event and run
`npm run check:live` again. Existing ticket QR codes retain their original contract.

## Contract-only local development

```sh
npx hardhat node
```

In another terminal:

```sh
npx hardhat run scripts/setupLocal.js --network localhost
```

This deploys/funds/whitelists the configured local wallets and updates the localhost
address. The presentation frontend intentionally supports Sepolia only. Local unit
tests use an ephemeral Hardhat chain and never alter the Sepolia deployment.
