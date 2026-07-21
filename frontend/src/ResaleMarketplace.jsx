import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin, Clock, Ticket, Tag, RefreshCw, Repeat, ShieldCheck,
  AlertCircle, Search, Hash, User, X, ExternalLink, CheckCircle2,
  XCircle, AlertTriangle, Wallet, ArrowDown, ArrowRight, Copy, Check, Sparkles
} from "lucide-react";
import { CONTRACT_ABI, PUBLIC_RPC_URL, getContractAddress, getDeployments } from "./constants";
import { fetchPublicEventStatusMap, normalizeEventName, EVENT_STATUS } from "./eventStatus";
import { formatEventWindow } from "./EventsHappening";
import { ipfsToHttp } from "./ipfs";
import { fetchProfile } from "./profileStore";
import { rm, ethLabel } from "./currency";

// Bounded-concurrency map — same reasoning as BuyerResellerDashboard: firing
// hundreds of contract reads at once gets public RPCs to rate-limit and silently
// drop responses. Keep only a handful in flight.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function withRetry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
  }
  throw lastErr;
}

// Multicall3 — deployed at the SAME canonical address on virtually every chain
// (incl. Sepolia). It batches many view reads into ONE eth_call, which is what
// makes the resale scan fast: instead of O(total supply) HTTP round-trips (one
// per token, the old path), we do a handful of aggregate3 calls. It also works
// even though the RPC disables JSON-RPC batching, because it's a single call.
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)",
];

// Batch-read `fn(...args)` across many argument sets via Multicall3. Returns an
// array aligned with `argSets`; entries that reverted/failed decode are null.
async function multicallRead(provider, contractAddress, iface, fn, argSets, chunkSize = 100) {
  const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const out = new Array(argSets.length).fill(null);
  for (let i = 0; i < argSets.length; i += chunkSize) {
    const slice = argSets.slice(i, i + chunkSize);
    const calls = slice.map((args) => ({
      target: contractAddress,
      allowFailure: true,
      callData: iface.encodeFunctionData(fn, args),
    }));
    const res = await withRetry(() => mc.aggregate3(calls));
    res.forEach((r, j) => {
      if (!r.success || r.returnData === "0x") return;
      try { out[i + j] = iface.decodeFunctionResult(fn, r.returnData); } catch { /* leave null */ }
    });
  }
  return out;
}

// A read-only provider + the chain we're reading.
//
// We deliberately do NOT read bulk on-chain data through the Privy embedded
// wallet: routing ~150 token reads through it is slow and flaky, and that was
// the cause of the "Could not load resale listings" error. Instead, like the
// main marketplace (CLAUDE.md: "read-only marketplace queries can use a public
// RPC"), we read from the public Sepolia RPC. The only exception is local dev,
// where there's no public RPC, so we use the wallet's localhost node.
async function getReadContext(wallet) {
  if (wallet) {
    try {
      const provider = new ethers.BrowserProvider(await wallet.getEthereumProvider());
      const chainId = Number((await provider.getNetwork()).chainId);
      if (chainId === 31337) return { provider, chainId }; // local Hardhat node only
    } catch { /* fall through to public RPC */ }
  }
  // batchMaxCount:1 — drpc's free tier rejects batched eth_call, which silently
  // dropped reads. Send each call as its own request.
  return {
    provider: new ethers.JsonRpcProvider(PUBLIC_RPC_URL, undefined, { batchMaxCount: 1 }),
    chainId: 11155111,
  };
}

// Fetch the complete Transfer history of ONE token (its chain of custody).
//
// Public RPCs cap how many blocks a single eth_getLogs may span: asking
// sepolia.drpc.org for the contract's whole life (~150k blocks and growing by
// ~7.2k/day) comes back "400 Bad Request", while a 9k-block window is served
// fine. That cap — not a missing history — is why the popup used to say the
// transfer history couldn't be loaded. So: try the whole range in one shot
// (fast, and what a generous RPC or the local node will serve), and fall back
// to walking the range in windows, run a few at a time so it stays quick.
const LOG_WINDOW = 9000;      // safely under the usual 10k-block cap
const MAX_WINDOWS = 80;       // hard bound so this can never run away

async function fetchTransferHistory(provider, contract, tokenId, startBlock) {
  const filter = contract.filters.Transfer(null, null, tokenId);

  try {
    return await contract.queryFilter(filter, startBlock);
  } catch {
    // Range too wide for this RPC — fall through to windowed scanning.
  }

  const head = await provider.getBlockNumber();
  const windows = [];
  for (let from = startBlock; from <= head; from += LOG_WINDOW) {
    windows.push([from, Math.min(from + LOG_WINDOW - 1, head)]);
  }
  // If the contract ever gets old enough to exceed the bound, prefer the most
  // recent history over none at all.
  const scanned = windows.length > MAX_WINDOWS ? windows.slice(-MAX_WINDOWS) : windows;

  const perWindow = await mapLimit(scanned, 6, async ([from, to]) => {
    try { return await withRetry(() => contract.queryFilter(filter, from, to)); }
    catch { return []; }   // one bad window shouldn't void the whole history
  });
  return perWindow.flat();
}

// ─── Public ledger (block explorer) links ───────────────────────────────────
// The whole point of the authenticity popup is that the buyer does NOT have to
// take our word for it — every claim we make links to Etherscan, where the same
// facts are readable independently of this app. The local Hardhat node has no
// explorer, so these return null there and the UI says so rather than linking
// to a page that would 404.
const explorer = (chainId) => (Number(chainId) === 11155111 ? "https://sepolia.etherscan.io" : null);
const nftUrl = (chainId, contract, tokenId) => {
  const base = explorer(chainId);
  return base ? `${base}/nft/${contract}/${tokenId}` : null;
};
const addressUrl = (chainId, addr) => {
  const base = explorer(chainId);
  return base ? `${base}/address/${addr}` : null;
};
const txUrl = (chainId, hash) => {
  const base = explorer(chainId);
  return base ? `${base}/tx/${hash}` : null;
};

/**
 * Public "Resale Tickets" storefront (route /resale).
 *
 * Lists individual ticket TOKENS currently flagged for peer-to-peer resale —
 * i.e. tokens whose current owner is NOT a whitelisted organizer (those are
 * primary inventory and live on the event marketplace instead). Each card buys
 * that exact token via the zero-value purchaseResaleTicket swap, which transfers
 * ownership seller -> buyer on-chain. The bought ticket then appears in the
 * buyer's wallet ("My Tickets") with its secure QR, and drops out of this grid.
 */
export default function ResaleMarketplace({ walletAddress, wallet, connectWallet }) {
  const navigate = useNavigate();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  // Which listing's ownership/authenticity popup is open.
  const [detailListing, setDetailListing] = useState(null);
  // The chain + contract the listings were actually read from, so the popup can
  // build correct explorer links (and re-verify against the same deployment).
  const [chainInfo, setChainInfo] = useState({ chainId: 11155111, contractAddress: getContractAddress(11155111) });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Pull event metadata (poster/venue/time) keyed by normalized on-chain
      // event name — same lookup BuyerResellerDashboard uses, so a resale card
      // always shows the actually-published event's venue/time, not whichever
      // same-named draft/duplicate doc happened to load first.
      const [{ provider, chainId }, eventStatusMap] = await Promise.all([
        getReadContext(wallet),
        fetchPublicEventStatusMap(),
      ]);
      const contractAddress = getContractAddress(chainId);
      setChainInfo({ chainId, contractAddress });
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);
      const iface = contract.interface;

      // Enumerate every minted token (1..nextId). Using getNextTicketId avoids
      // log-range limits that some free RPCs impose on eth_getLogs.
      const total = Number(await withRetry(() => contract.getNextTicketId()));
      const ids = Array.from({ length: total }, (_, i) => i + 1);

      // Discover the peer-resale candidates: { id, details, owner }. On Sepolia we
      // batch the reads through Multicall3 (a few calls total); on localhost —
      // where Multicall3 usually isn't deployed — fall back to per-token reads.
      let candidates = [];
      let mcSucceeded = false;
      const useMulticall = chainId === 11155111;

      if (useMulticall) {
        try {
          // 1) getTicketDetails for every token in a handful of batched calls.
          const detailsArr = await multicallRead(provider, contractAddress, iface, "getTicketDetails", ids.map((id) => [id]));
          const listed = [];
          ids.forEach((id, i) => {
            const d = detailsArr[i]?.[0];
            if (d && d.isForResale && !d.isUsed) listed.push({ id, details: d });
          });

          // 2) ownerOf only for the listed/unused ones, batched.
          const ownersArr = await multicallRead(provider, contractAddress, iface, "ownerOf", listed.map((l) => [l.id]));
          listed.forEach((l, i) => { l.owner = ownersArr[i]?.[0] || null; });

          // 3) whitelistedOrganizers for each unique owner, batched — to drop
          //    organizers' primary auto-listed inventory (peer resales only).
          const uniqueOwners = [...new Set(listed.map((l) => l.owner).filter(Boolean).map((o) => o.toLowerCase()))];
          const orgArr = await multicallRead(provider, contractAddress, iface, "whitelistedOrganizers", uniqueOwners.map((o) => [o]));
          const orgMap = new Map();
          uniqueOwners.forEach((o, i) => orgMap.set(o, !!orgArr[i]?.[0]));

          candidates = listed.filter((l) => l.owner && !orgMap.get(l.owner.toLowerCase()));
          mcSucceeded = true; // trust this result even if it's empty (no peer resales)
        } catch (mcErr) {
          console.warn("[resale] multicall path failed, falling back to per-token:", mcErr?.message);
        }
      }

      // Fallback (localhost, or if the multicall call itself failed): the original
      // bounded-concurrency per-token scan. NOT run when multicall succeeded with
      // zero results — that's a legitimately empty resale board.
      if (!mcSucceeded) {
        const orgCache = new Map();
        const isOrganizer = async (addr) => {
          const key = addr.toLowerCase();
          if (orgCache.has(key)) return orgCache.get(key);
          const res = await withRetry(() => contract.whitelistedOrganizers(addr)).catch(() => false);
          orgCache.set(key, res);
          return res;
        };
        candidates = (await mapLimit(ids, 6, async (id) => {
          try {
            const details = await withRetry(() => contract.getTicketDetails(id));
            if (!details.isForResale || details.isUsed) return null;
            const owner = await withRetry(() => contract.ownerOf(id));
            if (await isOrganizer(owner)) return null;
            return { id, details, owner };
          } catch { return null; }
        })).filter(Boolean);
      }

      const rows = candidates.map(({ id, details, owner }) => {
        const eventTitle = (details.eventName || `Ticket #${id}`).trim();
        const entry = eventStatusMap[normalizeEventName(eventTitle)];
        const meta = entry?.ev || null;
        return {
          id: id.toString(),
          eventTitle,
          owner,
          // Carried so the authenticity popup can warn on a canceled event —
          // the contract has no status concept, so this is the only signal that
          // an otherwise-valid token belongs to a voided event.
          eventStatus: entry?.status || null,
          resalePrice: parseFloat(ethers.formatEther(details.resalePrice || 0n)),
          originalPrice: parseFloat(ethers.formatEther(details.originalPrice || 0n)),
          banner: meta?.imageHash ? ipfsToHttp(meta.imageHash) : "",
          venue: meta?.venue || "Venue TBA",
          timestamp: meta?.timestamp || 0,
          category: meta?.category || "",
        };
      });

      // Attach seller display names from saved profiles (profiles/{address}),
      // so cards read "Sold by Syed" instead of a raw 0x… address. Cached + deduped
      // by profileStore, and resolved once per unique seller.
      const owners = [...new Set(rows.map((r) => r.owner.toLowerCase()))];
      const nameByOwner = new Map();
      await Promise.all(owners.map(async (o) => {
        try {
          const p = await fetchProfile(o);
          if (p?.name) nameByOwner.set(o, p.name);
        } catch { /* no profile / read failed — fall back to address */ }
      }));
      rows.forEach((r) => { r.sellerName = nameByOwner.get(r.owner.toLowerCase()) || ""; });

      // Cheapest first.
      rows.sort((a, b) => a.resalePrice - b.resalePrice);
      setListings(rows);
    } catch (e) {
      console.error("[resale] load failed:", e);
      setError(`Could not load resale listings: ${e?.shortMessage || e?.message || "unknown error"}. Try again.`);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => { load(); }, [load]);

  const handleBuy = async (listing) => {
    if (!wallet || !walletAddress) { connectWallet?.(); return; }
    if (listing.owner.toLowerCase() === walletAddress.toLowerCase()) return; // can't buy your own
    setBuyingId(listing.id);
    setError("");
    try {
      let eip = await wallet.getEthereumProvider();
      let provider = new ethers.BrowserProvider(eip);
      const currentChainId = Number((await provider.getNetwork()).chainId);
      const targetChainId = (currentChainId === 31337 || currentChainId === 11155111) ? currentChainId : 11155111;
      if (currentChainId !== targetChainId) {
        await wallet.switchChain(targetChainId);
        eip = await wallet.getEthereumProvider();
        provider = new ethers.BrowserProvider(eip);
      }

      // Demo mode: the swap executes with zero value, so we only need a gas buffer.
      const balance = await provider.getBalance(walletAddress);
      if (parseFloat(ethers.formatEther(balance)) < 0.0005) {
        setError(`Insufficient funds for gas. Top up a little Sepolia ETH and try again.`);
        setBuyingId(null);
        return;
      }

      const signer = await provider.getSigner();
      const contract = new ethers.Contract(getContractAddress(targetChainId), CONTRACT_ABI, signer);
      const tx = await contract.purchaseResaleTicket(listing.id, { value: 0n });
      await tx.wait();

      // On-chain ownership is now the buyer's; the wallet view reads chain state,
      // so the ticket appears in "My Tickets" with its QR and drops out of here.
      navigate("/wallet", { state: { purchased: 1, eventTitle: listing.eventTitle } });
    } catch (err) {
      console.error("[resale] purchase failed:", err);
      const reason = err?.reason || err?.data?.message || err?.message || "Transaction failed";
      if (err?.code === "ACTION_REJECTED" || /rejected|denied/i.test(reason)) {
        setError("You cancelled the purchase.");
      } else {
        setError(reason);
      }
      setBuyingId(null);
    }
  };

  const filtered = listings.filter((l) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      l.eventTitle.toLowerCase().includes(needle) ||
      l.venue.toLowerCase().includes(needle) ||
      l.id === needle.replace("#", "")
    );
  });

  return (
    <div className="max-w-7xl mx-auto px-6 sm:px-10 py-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-fuchsia-50 border border-fuchsia-200 px-3 py-1.5 text-xs font-medium text-fuchsia-700 mb-3">
            <Repeat size={14} /> Peer-to-peer
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Resale tickets</h1>
          <p className="text-slate-500 mt-1">
            Tickets put back up for sale by other fans — each capped at 110% of face value.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search event, venue, #id"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
            />
          </div>
          <button
            onClick={load}
            disabled={loading}
            title="Refresh listings"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-600 px-3 py-2.5 text-sm font-semibold transition-colors"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm animate-pulse">
              <div className="h-44 bg-slate-100" />
              <div className="p-5 space-y-3">
                <div className="h-5 bg-slate-100 rounded w-3/4" />
                <div className="h-4 bg-slate-100 rounded w-1/2" />
                <div className="h-10 bg-slate-100 rounded-xl mt-4" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-slate-300 rounded-2xl p-20 text-center bg-slate-50">
          <Repeat className="w-12 h-12 text-slate-300 mx-auto mb-5" />
          <p className="text-slate-600 font-semibold">{q ? "No resale tickets match your search" : "No resale tickets right now"}</p>
          <p className="text-slate-400 text-sm mt-1">
            {q ? "Try a different event, venue, or token id." : "When fans relist tickets they own, they'll show up here."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((l) => (
            <ResaleCard
              key={l.id}
              listing={l}
              isOwn={walletAddress && l.owner.toLowerCase() === walletAddress.toLowerCase()}
              buying={buyingId === l.id}
              disabled={!!buyingId}
              onBuy={() => handleBuy(l)}
              onInspect={() => setDetailListing(l)}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {detailListing && (
          <OwnershipModal
            key="ownership"
            listing={detailListing}
            wallet={wallet}
            chainId={chainInfo.chainId}
            contractAddress={chainInfo.contractAddress}
            isOwn={walletAddress && detailListing.owner.toLowerCase() === walletAddress.toLowerCase()}
            buying={buyingId === detailListing.id}
            disabled={!!buyingId}
            onBuy={() => { const l = detailListing; setDetailListing(null); handleBuy(l); }}
            onClose={() => setDetailListing(null)}
          />
        )}
      </AnimatePresence>

      <p className="mt-8 flex items-center gap-1.5 text-xs text-slate-400">
        <ShieldCheck size={13} /> Ownership transfers on-chain, seller → buyer. Resale is capped at 110% of the original face value.
      </p>
    </div>
  );
}

const shortAddr = (a) => (a ? `${a.substring(0, 6)}…${a.substring(38)}` : "");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const fmtDate = (ts) =>
  ts ? new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";


const ResaleCard = ({ listing, isOwn, buying, disabled, onBuy, onInspect }) => (
  <motion.div
    whileHover={{ y: -3 }}
    className="group bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col"
  >
    {/* Pressing the ticket opens the ownership + authenticity popup. The Buy
        button lives outside this press target so it can't be triggered by it. */}
    <button
      type="button"
      onClick={onInspect}
      aria-label={`Inspect ownership of ticket #${listing.id} for ${listing.eventTitle}`}
      className="block w-full text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
    <div className="relative h-44 overflow-hidden bg-slate-100">
      {listing.banner ? (
        <>
          <img src={listing.banner} aria-hidden="true" className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-40" />
          <img src={listing.banner} alt={listing.eventTitle} className="relative w-full h-full object-contain" loading="lazy" />
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-slate-300"><Ticket size={34} /></div>
      )}
      <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900/85 backdrop-blur text-white text-xs font-semibold rounded-full">
        <Hash size={12} /> {listing.id}
      </span>
      {listing.category && (
        <span className="absolute top-3 left-3 inline-flex px-2.5 py-1 bg-white/90 backdrop-blur text-fuchsia-700 text-xs font-semibold rounded-full border border-fuchsia-200">
          {listing.category}
        </span>
      )}
    </div>

    <div className="px-5 pt-5">
      <h3 className="text-lg font-semibold text-slate-900 leading-snug line-clamp-1">{listing.eventTitle}</h3>
      <div className="mt-2 space-y-1.5 text-sm text-slate-500">
        <p className="inline-flex items-center gap-1.5"><Clock size={14} className="text-slate-400 shrink-0" /> {formatEventWindow(listing.timestamp)}</p>
        <p className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-slate-400 shrink-0" /> <span className="truncate">{listing.venue}</span></p>
        <p className="inline-flex items-center gap-1.5">
          <User size={14} className="text-slate-400 shrink-0" />
          <span className="truncate">
            {isOwn ? "You" : <>Sold by <span className="font-medium text-slate-600">{listing.sellerName || shortAddr(listing.owner)}</span></>}
          </span>
        </p>
      </div>

      <div className="flex items-end justify-between mt-4 pt-4 border-t border-slate-100">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Tag size={13} className="text-slate-400" /> Resale price</p>
          <p className="text-xl font-bold text-slate-900">{rm(listing.resalePrice)}</p>
          <p className="text-xs text-slate-400">{ethLabel(listing.resalePrice, 3)}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition-colors group-hover:border-emerald-300 group-hover:bg-emerald-100">
          <ShieldCheck size={13} /> Check ownership
        </span>
      </div>
    </div>
    </button>

    <div className="p-5 pt-4 mt-auto">
      <button
        onClick={onBuy}
        disabled={disabled || isOwn}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2"
      >
        {isOwn ? "Your listing"
          : buying ? <><RefreshCw size={16} className="animate-spin" /> Processing…</>
          : <><Repeat size={16} /> Buy from peer</>}
      </button>
      <button
        onClick={onInspect}
        className="mt-2 w-full py-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center justify-center gap-1.5"
      >
        <ShieldCheck size={13} /> Verify ownership on the public ledger
      </button>
    </div>
  </motion.div>
);

// ─── Ownership & authenticity popup ─────────────────────────────────────────
// Everything a buyer needs to trust a peer-to-peer listing, read LIVE from the
// chain when the popup opens (never from the cached grid — a listing can be
// sold, delisted or scanned between the page load and this click):
//   · a pass/fail authenticity report (does the seller really own it? has it
//     already been used at a gate? is the price inside the 110% cap?)
//   · the full chain of custody, mint -> … -> current seller, from Transfer logs
//   · deep links to Etherscan so none of the above has to be taken on our word

const CHECK_STYLES = {
  pass: { Icon: CheckCircle2, cls: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
  fail: { Icon: XCircle, cls: "text-red-600", bg: "bg-red-50 border-red-200" },
  warn: { Icon: AlertTriangle, cls: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
};

const SectionTitle = ({ children }) => (
  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{children}</h4>
);

const CheckRow = ({ state, label, detail }) => {
  const { Icon, cls } = CHECK_STYLES[state] || CHECK_STYLES.warn;
  return (
    <li className="flex items-start gap-2.5 py-2.5">
      <Icon size={16} className={`mt-0.5 shrink-0 ${cls}`} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        {detail && <p className="text-xs text-slate-500 leading-relaxed">{detail}</p>}
      </div>
    </li>
  );
};

// One hop in the chain of custody.
const HopRow = ({ hop, chainId, isLast }) => {
  const url = txUrl(chainId, hop.hash);
  return (
    <li className="relative pl-7 pb-4 last:pb-0">
      {/* connector rail */}
      {!isLast && <span className="absolute left-[9px] top-5 bottom-0 w-px bg-slate-200" />}
      <span
        className={`absolute left-0 top-1 flex h-[19px] w-[19px] items-center justify-center rounded-full border-2 ${
          isLast ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
        }`}
      >
        {isLast ? <Wallet size={10} /> : hop.kind === "mint" ? <Sparkles size={10} className="text-slate-400" /> : <ArrowDown size={10} className="text-slate-400" />}
      </span>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-semibold text-slate-800">
          {hop.kind === "mint"
            ? "Created by the organizer"
            : isLast ? "Handed to the seller" : "Changed hands"}
        </p>
        <p className="text-[11px] text-slate-400 tabular-nums">
          {hop.timestamp ? fmtDate(hop.timestamp) : `block ${hop.blockNumber}`}
        </p>
      </div>
      <p className="mt-0.5 break-all font-mono text-xs text-slate-500">
        {hop.name && <span className="font-sans font-semibold text-slate-700">{hop.name} · </span>}
        {hop.to}
      </p>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
        >
          Proof <ExternalLink size={10} />
        </a>
      )}
    </li>
  );
};

const LedgerLink = ({ href, label, detail }) => {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50/50"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="truncate text-xs text-slate-500">{detail}</p>
      </div>
      <ExternalLink size={15} className="shrink-0 text-slate-400" />
    </a>
  );
};

const OwnershipModal = ({
  listing, wallet, chainId, contractAddress, isOwn, buying, disabled, onBuy, onClose,
}) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [live, setLive] = useState(null);      // fresh on-chain truth
  const [hops, setHops] = useState([]);        // chain of custody
  const [verifiedAt, setVerifiedAt] = useState(null); // when we read the chain
  const [copied, setCopied] = useState(false);

  // The Privy `wallet` object's identity changes on every render, so depending
  // on it directly would re-run the verification effect forever (the same trap
  // documented in BuyerResellerDashboard). We only need it once, when the popup
  // opens, so read it through a ref instead.
  const walletRef = useRef(wallet);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const { provider } = await getReadContext(walletRef.current);
        const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);

        // ownerOf reverts for a burned/nonexistent token — that alone answers
        // "is this ticket real?", so let it throw into the catch below.
        const [owner, details] = await Promise.all([
          withRetry(() => contract.ownerOf(listing.id)),
          withRetry(() => contract.getTicketDetails(listing.id)),
        ]);

        // Full transfer history for THIS token id (tokenId is an indexed ERC-721
        // Transfer arg, so each window is a cheap filtered log query).
        const startBlock = getDeployments(chainId)[0]?.startBlock ?? 0;
        let logs = [];
        try {
          logs = await fetchTransferHistory(provider, contract, listing.id, startBlock);
        } catch (logErr) {
          // History is a bonus; the checks above are what actually gates a buy.
          console.warn("[resale] provenance logs unavailable:", logErr?.message);
        }

        logs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index));
        const rawHops = logs.map((l) => ({
          from: l.args[0],
          to: l.args[1],
          kind: l.args[0] === ZERO_ADDRESS ? "mint" : "transfer",
          blockNumber: l.blockNumber,
          hash: l.transactionHash,
        }));

        // Block timestamps (one read per unique block, bounded) and seller-side
        // display names, both best-effort garnish on top of the addresses.
        const uniqueBlocks = [...new Set(rawHops.map((h) => h.blockNumber))];
        const tsByBlock = new Map();
        await mapLimit(uniqueBlocks, 4, async (bn) => {
          try { tsByBlock.set(bn, (await provider.getBlock(bn))?.timestamp || 0); } catch { /* keep block number only */ }
        });
        const uniqueTo = [...new Set(rawHops.map((h) => h.to.toLowerCase()))];
        const nameByAddr = new Map();
        await Promise.all(uniqueTo.map(async (a) => {
          try { const p = await fetchProfile(a); if (p?.name) nameByAddr.set(a, p.name); }
          catch { /* no profile — address is enough */ }
        }));

        if (cancelled) return;
        setHops(rawHops.map((h) => ({
          ...h,
          timestamp: tsByBlock.get(h.blockNumber) || 0,
          name: nameByAddr.get(h.to.toLowerCase()) || "",
        })));
        setLive({
          owner,
          isUsed: !!details.isUsed,
          isForResale: !!details.isForResale,
          resaleWei: details.resalePrice ?? 0n,
          originalWei: details.originalPrice ?? 0n,
          eventName: details.eventName || "",
        });
        setVerifiedAt(new Date());
      } catch (e) {
        console.error("[resale] ownership verification failed:", e);
        if (!cancelled) setLoadError(e?.shortMessage || e?.message || "Could not reach the blockchain.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // `wallet` intentionally absent — it's read through walletRef (see above).
  }, [listing.id, contractAddress, chainId]);

  const copyAddress = () => {
    navigator.clipboard.writeText(listing.owner);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // Build the verification report from the freshly-read state.
  const checks = [];
  if (live) {
    const sellerStillOwns = live.owner.toLowerCase() === listing.owner.toLowerCase();
    // 110% cap compared in wei — floats drift at this precision.
    const capWei = (live.originalWei * 110n) / 100n;
    const withinCap = live.resaleWei <= capWei;
    const canceled = listing.eventStatus === EVENT_STATUS.CANCELED;

    checks.push({
      state: "pass",
      label: "The ticket is genuine",
      detail: `Ticket #${listing.id} was issued by the official TicketChain contract${live.eventName ? ` for ${live.eventName}` : ""}.`,
    });
    checks.push({
      state: sellerStillOwns ? "pass" : "fail",
      label: sellerStillOwns ? "The seller owns it right now" : "The seller no longer owns it",
      detail: sellerStillOwns
        ? "The blockchain names their wallet as today's owner."
        : "It moved to another wallet since this page loaded. Refresh the list.",
    });
    checks.push({
      state: live.isUsed ? "fail" : "pass",
      label: live.isUsed ? "It has already been used" : "Nobody has used it",
      detail: live.isUsed
        ? "It was scanned at the gate, so it can't get anyone in again."
        : "It has never been scanned at a gate, so it still works for entry.",
    });
    checks.push({
      state: live.isForResale ? "pass" : "fail",
      label: live.isForResale ? "It really is for sale" : "The listing was withdrawn",
      detail: live.isForResale
        ? "The owner marked it for sale on the blockchain itself, not just here."
        : "The owner took it off the market. Refresh the list.",
    });
    checks.push({
      state: withinCap ? "pass" : "fail",
      label: withinCap ? "The price is fair" : "The price is too high",
      detail: `${rm(listing.resalePrice)} against a ${rm(listing.originalPrice)} face value. Nobody can charge above ${rm(parseFloat(ethers.formatEther(capWei)))} — the contract refuses it.`,
    });
    if (canceled) {
      checks.push({
        state: "warn",
        label: "But this event was canceled",
        detail: "The ticket is real, but the organizer called the event off, so it won't get you in anywhere.",
      });
    }
  }

  const hardFail = checks.some((c) => c.state === "fail");
  const hasWarning = checks.some((c) => c.state === "warn");
  const verdict = hardFail
    ? { cls: "border-red-200 bg-red-50", accent: "text-red-700", Icon: XCircle, iconCls: "bg-red-100 text-red-600", title: "Don't buy this one", body: "The blockchain doesn't match what this listing claims. The failed check below explains why." }
    : hasWarning
      ? { cls: "border-amber-200 bg-amber-50", accent: "text-amber-800", Icon: AlertTriangle, iconCls: "bg-amber-100 text-amber-600", title: "Real ticket, but read this", body: "The ticket itself is genuine. Something about the event needs your attention first." }
      : { cls: "border-emerald-200 bg-emerald-50", accent: "text-emerald-800", Icon: ShieldCheck, iconCls: "bg-emerald-100 text-emerald-600", title: "This ticket is real", body: "We asked the blockchain directly, just now. Everything the seller claims checks out." };

  const hasExplorer = !!explorer(chainId);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 16 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Ownership and authenticity of ticket #${listing.id}`}
        className="my-auto max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-100 bg-white/95 p-6 backdrop-blur">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <ShieldCheck size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold leading-tight text-slate-900">Is this ticket real?</h3>
            <p className="truncate text-sm text-slate-500">
              Ticket <span className="font-mono">#{listing.id}</span> · {listing.eventTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {loading ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                <RefreshCw size={15} className="animate-spin" /> Checking this ticket on the blockchain…
              </div>
              <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : loadError ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Couldn't verify this ticket</p>
                <p className="text-red-600">{loadError}</p>
                <p className="mt-1 text-xs text-red-600">
                  Don't buy until this succeeds — an unverifiable ticket may not exist.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* ① The answer, in one line */}
              <div className={`rounded-2xl border p-5 ${verdict.cls}`}>
                <div className="flex items-start gap-3.5">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${verdict.iconCls}`}>
                    <verdict.Icon size={22} />
                  </div>
                  <div className="min-w-0">
                    <p className={`text-base font-bold leading-tight ${verdict.accent}`}>{verdict.title}</p>
                    <p className={`mt-1 text-sm leading-relaxed ${verdict.accent} opacity-80`}>{verdict.body}</p>
                  </div>
                </div>
                {verifiedAt && (
                  <p className={`mt-3 border-t border-black/10 pt-3 text-xs font-medium ${verdict.accent} opacity-70`}>
                    Checked at {verifiedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · straight from the blockchain, not from our records
                  </p>
                )}
              </div>

              {/* ② Who owns it — the thing the buyer actually came to see */}
              <section>
                <SectionTitle>Who owns this ticket</SectionTitle>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                      <User size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-900">
                          {isOwn ? "You" : listing.sellerName || "This seller"}
                        </p>
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                          <CheckCircle2 size={10} /> Confirmed owner
                        </span>
                      </div>
                      <p className="mt-0.5 break-all font-mono text-xs text-slate-500">{listing.owner}</p>
                    </div>
                    <button
                      onClick={copyAddress}
                      title="Copy wallet address"
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        copied ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                    </button>
                  </div>

                  {/* What happens when you buy — makes "peer-to-peer" concrete */}
                  <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                    <div className="min-w-0 flex-1 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Now</p>
                      <p className="truncate text-xs font-semibold text-slate-700">{isOwn ? "You" : listing.sellerName || shortAddr(listing.owner)}</p>
                    </div>
                    <ArrowRight size={16} className="shrink-0 text-indigo-400" />
                    <div className="min-w-0 flex-1 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">After you buy</p>
                      <p className="truncate text-xs font-semibold text-indigo-600">Your wallet</p>
                    </div>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed text-slate-500">
                    {isOwn
                      ? "This is your own listing — this is exactly what other buyers see when they check it."
                      : "The ticket moves straight from their wallet into yours, recorded on the blockchain. TicketChain never holds it in between."}
                  </p>
                </div>
              </section>

              {/* ③ The checks */}
              <section>
                <SectionTitle>What we checked</SectionTitle>
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-4">
                  {checks.map((c) => <CheckRow key={c.label} {...c} />)}
                </ul>
              </section>

              {/* ④ History */}
              <section>
                <SectionTitle>
                  Its history{hops.length ? ` · ${hops.length} record${hops.length === 1 ? "" : "s"}` : ""}
                </SectionTitle>
                {hops.length ? (
                  <>
                    <ol className="relative rounded-2xl border border-slate-200 bg-white p-4">
                      {hops.map((h, i) => (
                        <HopRow key={`${h.hash}-${i}`} hop={h} chainId={chainId} isLast={i === hops.length - 1} />
                      ))}
                    </ol>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Every hand this ticket has passed through, from the day the organizer created it. This list can't
                      be edited — not by the seller, and not by us.
                    </p>
                  </>
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-xs leading-relaxed text-slate-500">
                    We couldn't load the full history this time.{" "}
                    {hasExplorer ? "You can read it on Etherscan below." : ""} The checks above already confirm who
                    owns it today.
                  </p>
                )}
              </section>

              {/* ⑤ Independent proof */}
              <section>
                <SectionTitle>Don't take our word for it</SectionTitle>
                <p className="mb-3 text-xs leading-relaxed text-slate-500">
                  {hasExplorer
                    ? "Etherscan is a public record of the blockchain, run by strangers with no connection to TicketChain. It will show you the same owner and the same history — proof that we aren't just telling you what you want to hear."
                    : "You're on a local test network, which has no public explorer. On the live network every record here links out to Etherscan."}
                </p>
                {hasExplorer ? (
                  <div className="space-y-2">
                    <LedgerLink
                      href={nftUrl(chainId, contractAddress, listing.id)}
                      label={`See ticket #${listing.id} for yourself`}
                      detail="Its owner and every transfer ever made"
                    />
                    <LedgerLink
                      href={addressUrl(chainId, listing.owner)}
                      label="Look up the seller's wallet"
                      detail={shortAddr(listing.owner)}
                    />
                    <LedgerLink
                      href={addressUrl(chainId, contractAddress)}
                      label="Inspect the TicketChain contract"
                      detail={shortAddr(contractAddress)}
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs text-slate-500">
                    <p className="break-all">contract {contractAddress}</p>
                    <p className="mt-1">chain id {chainId}</p>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Buy */}
        <div className="sticky bottom-0 border-t border-slate-100 bg-white/95 p-6 backdrop-blur">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Tag size={13} className="text-slate-400" /> Resale price</p>
              <p className="text-xl font-bold text-slate-900">{rm(listing.resalePrice)}</p>
            </div>
            <p className="text-xs text-slate-400">{ethLabel(listing.resalePrice, 3)}</p>
          </div>
          <button
            onClick={onBuy}
            disabled={disabled || isOwn || loading || !!loadError || hardFail}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400"
          >
            {isOwn ? "Your listing"
              : buying ? <><RefreshCw size={16} className="animate-spin" /> Processing…</>
              : hardFail ? "Buying blocked — failed verification"
              : loading ? "Verifying…"
              : <><Repeat size={16} /> Buy from peer</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
