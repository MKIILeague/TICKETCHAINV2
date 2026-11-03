// Read-only checks. Never signs transactions or prints credentials.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

const requireFrontend = createRequire(new URL('../frontend/package.json', import.meta.url));
const readEnv = (path) => fs.existsSync(path) ? dotenv.parse(fs.readFileSync(path)) : {};
const front = readEnv('frontend/.env');
const source = fs.readFileSync('frontend/src/constants.js', 'utf8');
const address = source.match(/export const CONTRACT_ADDRESS = "([^"]+)"/)[1];
const rpc = source.match(/export const PUBLIC_RPC_URL = "([^"]+)"/)[1];
let failures = 0;
async function check(label, fn) {
  try { console.log(`PASS ${label}: ${await fn()}`); }
  catch (error) { failures++; console.log(`FAIL ${label}: ${error.shortMessage || error.message}`); }
}
const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
await check('Pinata configuration', async () => {
  if (!front.VITE_PINATA_JWT?.trim()) throw new Error('VITE_PINATA_JWT is missing in frontend/.env');
  const result = await fetchJson('https://api.pinata.cloud/data/testAuthentication', {
    headers: { Authorization: `Bearer ${front.VITE_PINATA_JWT}` },
  });
  return result.message || 'authenticated';
});
await check('Privy verification keys', async () => {
  const result = await fetchJson('https://auth.privy.io/api/v1/apps/cmpwse3mr000i0ejp1lre5fy9/jwks.json');
  return result.keys.map((k) => k.alg || k.kty).join(', ');
});
await check('Sepolia contract', async () => {
  const request = new ethers.FetchRequest(rpc);
  request.timeout = 12000;
  const provider = new ethers.JsonRpcProvider(request, 11155111, { staticNetwork: true, batchMaxCount: 1 });
  try {
    if (await provider.getCode(address) === '0x') throw new Error(`No contract at ${address}`);
    const contract = new ethers.Contract(address, [
      'function owner() view returns(address)', 'function paused() view returns(bool)',
      'function getNextTicketId() view returns(uint256)',
    ], provider);
    const owner = await contract.owner();
    const paused = await contract.paused();
    const count = await contract.getNextTicketId();
    if (paused) throw new Error(`Contract is paused; owner ${owner}`);
    return `${address}, owner ${owner}, ${count} minted tickets, unpaused`;
  } finally { provider.destroy(); }
});
await check('Firestore storefront', async () => {
  const { initializeApp, deleteApp } = requireFrontend('firebase/app');
  const { initializeFirestore, collection, query, where, getDocs, terminate } = requireFrontend('firebase/firestore');
  const firebaseSource = fs.readFileSync('frontend/src/firebase.js', 'utf8');
  const config = Object.fromEntries([...firebaseSource.matchAll(/(apiKey|projectId|appId): "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const app = initializeApp(config, 'presentation-check');
  const db = initializeFirestore(app, { experimentalForceLongPolling: true });
  let timer;
  try {
    const snapshot = await Promise.race([
      getDocs(query(collection(db, 'events'), where('status', '==', 'published'))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('read timed out after 12s')), 12000); }),
    ]);
    const upcoming = snapshot.docs.filter((d) => !d.data().timestamp || d.data().timestamp * 1000 > Date.now()).length;
    if (!upcoming) throw new Error(`${snapshot.size} published events, none upcoming. Create a future event before presenting.`);
    return `${snapshot.size} published events; ${upcoming} upcoming`;
  } finally { clearTimeout(timer); await terminate(db); await deleteApp(app); }
});
process.exitCode = failures ? 1 : 0;
