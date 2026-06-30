import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { motion } from "framer-motion";
import {
  MapPin, Clock, Ticket, Tag, RefreshCw, Repeat, ShieldCheck,
  AlertCircle, Search, Hash, User
} from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import { CONTRACT_ABI, PUBLIC_RPC_URL, getContractAddress } from "./constants";
import { formatEventWindow } from "./EventsHappening";
import { ipfsToHttp } from "./ipfs";
import { fetchProfile } from "./profileStore";

const USD_PER_ETH = 3500;
const usd = (eth) =>
  `$${(Number(eth || 0) * USD_PER_ETH).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

  // Pull event metadata (poster/venue/time) from Firestore, keyed by the on-chain
  // event name. EventCheckout matches the same way: details.eventName === headline.
  const loadEventMeta = useCallback(async () => {
    const map = new Map();
    try {
      const snap = await getDocs(collection(db, "events"));
      snap.forEach((d) => {
        const ev = d.data();
        const key = (ev.headline || "").trim();
        if (key && !map.has(key)) map.set(key, ev);
      });
    } catch (e) {
      console.warn("[resale] event meta load failed:", e?.message);
    }
    return map;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [{ provider, chainId }, metaMap] = await Promise.all([
        getReadContext(wallet),
        loadEventMeta(),
      ]);
      const contract = new ethers.Contract(getContractAddress(chainId), CONTRACT_ABI, provider);

      // Enumerate every minted token (1..nextId). Using getNextTicketId avoids
      // log-range limits that some free RPCs impose on eth_getLogs.
      const total = Number(await withRetry(() => contract.getNextTicketId()));
      const ids = Array.from({ length: total }, (_, i) => i + 1);

      // Cache "is this address a whitelisted organizer?" so we don't re-ask per token.
      const orgCache = new Map();
      const isOrganizer = async (addr) => {
        const key = addr.toLowerCase();
        if (orgCache.has(key)) return orgCache.get(key);
        const res = await withRetry(() => contract.whitelistedOrganizers(addr)).catch(() => false);
        orgCache.set(key, res);
        return res;
      };

      const rows = (await mapLimit(ids, 4, async (id) => {
        try {
          const details = await withRetry(() => contract.getTicketDetails(id));
          if (!details.isForResale || details.isUsed) return null;
          const owner = await withRetry(() => contract.ownerOf(id));
          // Peer resales only — skip organizers' primary auto-listed inventory.
          if (await isOrganizer(owner)) return null;

          const eventTitle = (details.eventName || `Ticket #${id}`).trim();
          const meta = metaMap.get(eventTitle) || null;
          return {
            id: id.toString(),
            eventTitle,
            owner,
            resalePrice: parseFloat(ethers.formatEther(details.resalePrice || 0n)),
            originalPrice: parseFloat(ethers.formatEther(details.originalPrice || 0n)),
            banner: meta?.imageHash ? ipfsToHttp(meta.imageHash) : "",
            venue: meta?.venue || "Venue TBA",
            timestamp: meta?.timestamp || 0,
            category: meta?.category || "",
          };
        } catch {
          return null; // unreadable / nonexistent token — skip
        }
      })).filter(Boolean);

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
  }, [wallet, loadEventMeta]);

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
            />
          ))}
        </div>
      )}

      <p className="mt-8 flex items-center gap-1.5 text-xs text-slate-400">
        <ShieldCheck size={13} /> Ownership transfers on-chain, seller → buyer. Resale is capped at 110% of the original face value.
      </p>
    </div>
  );
}

const shortAddr = (a) => (a ? `${a.substring(0, 6)}…${a.substring(38)}` : "");

const ResaleCard = ({ listing, isOwn, buying, disabled, onBuy }) => (
  <motion.div
    whileHover={{ y: -3 }}
    className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col"
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

    <div className="p-5 flex-1 flex flex-col">
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
          <p className="text-xl font-bold text-slate-900">{listing.resalePrice.toFixed(3)} <span className="text-sm font-medium text-slate-400">ETH</span></p>
          <p className="text-xs text-slate-400">≈ {usd(listing.resalePrice)}</p>
        </div>
      </div>

      <button
        onClick={onBuy}
        disabled={disabled || isOwn}
        className="mt-4 w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2"
      >
        {isOwn ? "Your listing"
          : buying ? <><RefreshCw size={16} className="animate-spin" /> Processing…</>
          : <><Repeat size={16} /> Buy from peer</>}
      </button>
    </div>
  </motion.div>
);
