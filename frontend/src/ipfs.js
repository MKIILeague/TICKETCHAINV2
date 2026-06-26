// ─── IPFS configuration layer (Pinata) ──────────────────────────────────────
// Single seam for pushing event media + metadata to IPFS. The rest of the app
// only imports the helpers below, so swapping providers later means editing
// just this file.
//
// Setup: create a free Pinata account, generate an API key with the
// `pinFileToIPFS` + `pinJSONToIPFS` scopes, and put the JWT in frontend/.env:
//
//     VITE_PINATA_JWT=eyJhbGciOi...
//
// Vite only exposes env vars prefixed with VITE_. Restart `npm run dev` after
// editing .env. See frontend/.env.example.

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
const PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

// Public gateway used to turn an ipfs:// URI or bare CID into something a
// browser <img> can load.
export const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

/** Whether a Pinata JWT is configured. Lets the UI fail fast with guidance. */
export function isIpfsConfigured() {
  return Boolean(PINATA_JWT && PINATA_JWT.trim());
}

function assertConfigured() {
  if (!isIpfsConfigured()) {
    throw new Error(
      "IPFS is not configured. Add VITE_PINATA_JWT to frontend/.env and restart the dev server."
    );
  }
}

/** Convert an ipfs:// URI (or bare CID) into an HTTP gateway URL for display. */
export function ipfsToHttp(uri) {
  if (!uri) return "";
  const cid = uri.startsWith("ipfs://") ? uri.slice("ipfs://".length) : uri;
  return `${IPFS_GATEWAY}${cid}`;
}

/**
 * Pin a single file (e.g. the event poster) to IPFS.
 * @returns {Promise<string>} the CID hash
 */
export async function uploadFileToIPFS(file, name) {
  assertConfigured();
  if (!file) throw new Error("No file provided to uploadFileToIPFS.");

  const body = new FormData();
  body.append("file", file);
  body.append("pinataMetadata", JSON.stringify({ name: name || file.name }));
  body.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const res = await fetch(PIN_FILE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` }, // don't set Content-Type — browser adds the multipart boundary
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Pinata file upload failed (${res.status}). ${detail}`);
  }
  const json = await res.json();
  return json.IpfsHash;
}

/**
 * Pin a JSON object (e.g. the ERC-721 token metadata) to IPFS.
 * @returns {Promise<string>} the CID hash
 */
export async function uploadJSONToIPFS(metadata, name) {
  assertConfigured();

  const res = await fetch(PIN_JSON_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataContent: metadata,
      pinataMetadata: { name: name || "ticketchain-metadata" },
      pinataOptions: { cidVersion: 1 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Pinata JSON upload failed (${res.status}). ${detail}`);
  }
  const json = await res.json();
  return json.IpfsHash;
}

/**
 * Step A end-to-end: pin the poster, build standard ERC-721 metadata that
 * references it, pin the metadata, and return the pieces the mint + Firestore
 * steps need.
 *
 * @returns {Promise<{ metadataCid: string, imageCid: string, tokenURI: string }>}
 */
export async function uploadEventMetadata({ posterFile, headline, description, category, venue, eventTimestamp }) {
  // 1. Pin the poster image.
  const imageCid = await uploadFileToIPFS(posterFile, `${headline} — poster`);

  // 2. Build OpenSea-style ERC-721 metadata that points at the pinned image.
  const metadata = {
    name: headline,
    description: description || "",
    image: `ipfs://${imageCid}`,
    attributes: [
      { trait_type: "Category", value: category },
      { trait_type: "Venue", value: venue },
      // Numeric, displayed as a date by metadata-aware marketplaces.
      { trait_type: "Event date", value: eventTimestamp, display_type: "date" },
    ],
  };

  // 3. Pin the metadata document.
  const metadataCid = await uploadJSONToIPFS(metadata, `${headline} — metadata`);

  return { metadataCid, imageCid, tokenURI: `ipfs://${metadataCid}` };
}
