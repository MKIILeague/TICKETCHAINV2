# TicketChain: System Architecture & Phase-by-Phase Development Blueprint

This configuration document establishes the absolute engineering baseline and functional requirements for **TicketChain**, a hybrid decentralized ticketing platform. All subsequent codebase generation, smart contract logic, database schemas, and client-side views must strictly follow the specifications laid out in this file.

---

## 👥 1. System Actor & Access Matrix

The system governs exactly four user roles. The application routing must dynamically lock or expose modules based on these permissions.

### 1.1 Admin
* **Role Objective:** System gatekeeper and platform trust authority.
* **Core Flows:** Accesses a protected administrative console that interfaces with the off-chain registration database. Reviews incoming organizer business submissions and toggles their profile states from `Pending` to `Approved` or `Rejected`.
* **Blockchain Privileges:** Possesses the administrative authority required to grant verified organizers execution authorization over the core ticket deployment workflows.

### 1.2 Organiser
* **Role Objective:** Event creator, inventory distributor, and data analyzer.
* **Core Flows:** Submits an initial platform onboarding form (defaults to a `Pending` state in the database). Upon receiving manual approval and whitelisting from the Admin, the dashboard unlocks features allowing them to initialize event projects, batch-mint unique structural ticket collections onto the blockchain, and analyze sales performance patterns.
* **Blockchain Privileges:** Authorized to call contract generation functions exclusively for event projects under their ownership.

### 1.3 Buyer
* **Role Objective:** End consumer, asset owner, and fair-market secondary participant.
* **Core Flows:** Authenticates on the client web interface utilizing **Privy.io** (via email or social identity providers). The platform automatically provisions a non-custodial, embedded Web3 wallet behind the scenes. The buyer can explore primary listings, purchase ticket tokens, manage their digital vault, list an asset for resale, and view unique secure ticket QR code displays.
* **Blockchain Privileges:** Signs ticket purchases, safe custody transfers, and marketplace escrow handshakes using their embedded wallet keys.

### 1.4 Verifier
* **Role Objective:** On-site venue access enforcement staff.
* **Core Flows:** Authenticates into a specialized mobile-optimized camera portal. Scans the cryptographic JSON string payloads embedded inside the buyer's QR codes at the physical entrance gates.
* **CRITICAL ARCHITECTURAL CONSTRAINT:** The verifier device **MUST maintain an active internet connection** at all times. It is strictly prohibited from validating entry offline. The verification loop must directly query the live state variables on the blockchain to prevent replay attacks, double-spending, or cloning before executing a block status alteration.

---

## 🛠️ 2. Technical Stack & Architectural Rules

### 2.1 Web3 Onboarding & Identity via Privy.io
* Traditional browser-injected wallets or separate mobile dApp browsers (e.g., MetaMask extensions) are bypassed for the consumer journey to maximize user experience.
* **Privy.io** governs the entire authentication cycle, linking web2-style credential mapping directly with programmatic embedded wallets.

### 2.2 Distributed Ledger Protocol (Ethereum Sepolia Testnet)
* **Token Primitives:** Every individual ticket asset is modeled as an independent, non-fungible token conforming to the **ERC-721** standard.
* **Metadata State Structuring:** Holds immutable core attributes (`EventID`, `Category`, `SeatNumber`) alongside mutable operational flags (`Status`).
* **The 110% Anti-Scalping Escrow Rule:** The marketplace smart contract must enforce an uncompromisable programmatic ceiling on secondary transfers. Any function call attempting to list or trade a secondary ticket at a valuation higher than **110% of its initial primary face value** must execute a transaction revert immediately.

### 2.3 Hybrid Storage Partitioning (Firebase Firestore & IPFS)
* **Firebase Firestore:** Controls all high-frequency, dynamic relational data feeds requiring sub-second querying layouts. This includes organizing onboarding states (`pending`/`approved`), hosting searchable text listings for public events, routing real-time platform metrics, and capturing system audit trails.
* **IPFS:** Serves as the decentralized file system hosting static json metadata descriptors and raw image media layers tied structurally to the minted token identifiers.

---

## 🏁 3. Step-by-Step Implementation Strategy

### Phase 1: Authentication Engine & Relational Schema Integration
1. Initialize a unified codebase consisting of a React.js (Vite-optimized) PWA setup and an environment configuration for Ethereum smart contracts.
2. Embed the `@privy-io/react-auth` context layer globally over the client-side single page app. Configure the provider interface to enforce background embedded wallet generation on initial registration.
3. Establish connection channels with Firebase Firestore. Provision structural collections and deploy indexing schemas matching the following layout:
   * `/organisers/{organiserId}` -> `{ email: string, legalName: string, status: "pending" | "approved" | "rejected" }`
   * `/events/{eventId}` -> `{ organiserId: string, headline: string, timestamp: number, aggregateSupply: number }`

### Phase 2: Core Blockchain Development (Smart Contracts)
1. Write an ERC-721 token matrix contract incorporating secure access parameter wrappers. Expose a public mint array restricted by modifier gates that validate if the calling identity is mapped to an approved organizer status.
2. Develop a companion marketplace escrow contract governing secondary transactions. 
3. Hardcode the exact mathematical anti-scalping assertion within the listing initialization loop:
   ```solidity
   uint256 maximumAllowedPrice = (initialPrice * 110) / 100;
   require(targetSecondaryPrice <= maximumAllowedPrice, "TicketChain Error: Listing violates the strict 110% anti-scalping price ceiling.");

### Phase 3: Role-Guarded Interface Modules
Admin Console: Implement a dashboard component drawing from Firestore documents where status == "pending". Build interactive state-handling elements that commit profile mutations back to the database and register whitelisting credentials on-chain.

Organiser Terminal: Build a route-guarded operational workspace that checks for an "approved" credential status. Create an event deployment wizard handling IPFS file uploads alongside frontend hooks that invoke the contract ticket minting loops. Construct an analytics display parsing sales metrics.

Buyer Marketplace & Digital Vault: Establish a storefront parsing primary event records and allowed marketplace listings. Link payment pathways to the underlying contract via the Privy embedded wallet instance. Design a personal token inventory module that reads blockchain token balances and parses asset attributes.

###Phase 4: Dynamic Entry Verification Loop
QR Packet Encoding: Program a data-packaging mechanism that wraps the token ID, owner wallet address, and an asymmetric contract validation parameter into a high-density QR asset wrapper.

Verifier Camera Module: Construct a specialized, mobile-responsive view running hardware-integrated barcode interpretation routines.

The Live Online Verification Pipeline:

Step A (Payload Extraction): The verifier app decodes the string format from the captured QR visual layer.

Step B (Connectivity Assurance): The runtime executes an asynchronous check to confirm an active internet connection. If the device is offline, it halts processing and displays a "Network Error: Verifier Connection Required" interface.

Step C (Live State Query): The scanner contacts the Sepolia network to read the live Status parameter of the target token ID. If the blockchain variable resolves to Used, it displays an error screen: "DENIED: Ticket Already Redeemed".

Step D (Atomic State Transition): If valid, the verifier signs and broadcasts an immediate transaction changing the token state to Used on the blockchain, simultaneously displaying an access confirmation: "APPROVED: Ticket Validated Successfully".