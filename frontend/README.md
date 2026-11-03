# TicketChain frontend

React 19, Vite 8, Privy embedded wallets, ethers 6, Firestore and IPFS.

```sh
npm run dev
npm test
npm run lint
npm run build
npm run preview
```

Use http://localhost:5173 for development. The presentation uses Sepolia with
simulated ticket payments; test ETH is needed for gas. Copy `.env.example` to
`.env` only on a fresh setup and configure the Pinata JWT before uploading posters.
Do not overwrite an existing `.env` or commit it.

See [the project run guide](../run_guide.md) and
[presentation status](../docs/PRESENTATION_STATUS.md) for roles, service setup,
Firestore recovery, contract versions and the manual rehearsal.
