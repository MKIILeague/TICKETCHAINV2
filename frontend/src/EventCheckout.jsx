import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ethers } from "ethers";
import {
  MapPin, Clock, Ticket, ArrowLeft, RefreshCw, ShieldCheck, Ban,
  CalendarX, AlertCircle, CheckCircle2, Tag, Minus, Plus
} from "lucide-react";
import { doc, onSnapshot, updateDoc, increment } from "firebase/firestore";
import { db } from "./firebase";
import { CONTRACT_ABI, START_BLOCK, getContractAddress } from "./constants";
import { EVENT_STATUS, effectiveStatus, isSaleBlocked } from "./eventStatus";
import { ipfsToHttp } from "./ipfs";
import { formatEventWindow } from "./EventsHappening";

import { rm, ethLabel } from "./currency";

/**
 * Single-event checkout (route /event/:eventId) with multi-quantity purchase.
 *
 * The deployed contract sells the organiser's auto-listed primary tickets one at
 * a time via purchaseResaleTicket(ticketId). There's no buyer-facing batch-mint,
 * so buying N tickets = N purchaseResaleTicket calls (N wallet approvals) against
 * N distinct available token IDs. Inventory is tracked off-chain via the
 * Firestore `sold` counter (aggregateSupply - sold = remaining).
 */
export default function EventCheckout({ walletAddress, wallet, connectWallet }) {
  const { eventId } = useParams();
  const navigate = useNavigate();

  const [ev, setEv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [qty, setQty] = useState(1);
  const [phase, setPhase] = useState("idle"); // idle | buying | done
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");

  // Live event document.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "events", eventId),
      (snap) => {
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        setEv({ id: snap.id, ...snap.data() });
        setLoading(false);
      },
      (err) => { console.error("Event load failed:", err); setLoading(false); }
    );
    return () => unsub();
  }, [eventId]);

  const status = ev ? effectiveStatus(ev) : null;
  const blocked = isSaleBlocked(status);

  const supply = Number(ev?.aggregateSupply) || 0;
  const sold = Number(ev?.sold) || 0;
  const remaining = Math.max(0, supply - sold);
  const price = Number(ev?.priceEth) || 0;
  const totalCost = price * qty;

  // Keep the chosen quantity within [1, remaining] as inventory changes live.
  useEffect(() => {
    setQty((q) => Math.min(Math.max(1, q), Math.max(1, remaining)));
  }, [remaining]);

  const exceedsStock = qty > remaining;

  // The contract address the event was actually minted on (stored at publish).
  // Falls back to the active network's address for legacy/local events.
  const contractAddressFor = useCallback((chainId) => ev?.contractAddress || getContractAddress(chainId), [ev]);

  // Find every listed, unused ticket for this event, cheapest first.
  // Deliberately NOT filtered by organiser/ownership: any ticket that's listed
  // for resale (primary face-value listing or a secondary listing) is buyable,
  // which is far more robust across resales and redeploys.
  const findAvailableTickets = useCallback(async (provider, evt) => {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const contract = new ethers.Contract(contractAddressFor(chainId), CONTRACT_ABI, provider);
    const startBlock = chainId === 11155111 ? START_BLOCK : 0;

    let logs;
    try {
      logs = await contract.queryFilter(contract.filters.TicketMinted(), startBlock);
    } catch {
      logs = await contract.queryFilter(contract.filters.TicketMinted(), 0); // some RPCs cap block ranges
    }

    const wantName = (evt.headline || "").trim();
    const list = [];
    for (const log of logs) {
      try {
        const id = log.args[0];
        const details = await contract.getTicketDetails(id);
        if ((details.eventName || "").trim() !== wantName) continue;
        if (!details.isForResale || details.isUsed) continue;
        list.push({ id: id.toString(), price: details.resalePrice });
      } catch { /* skip unreadable token */ }
    }
    list.sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
    return list;
  }, [contractAddressFor]);

  const handleBuy = async () => {
    if (phase === "buying") return;
    if (!wallet || !walletAddress) { connectWallet?.(); return; }
    if (blocked) { setError("This event is no longer on sale."); return; }
    if (remaining <= 0) { setError("This event is sold out."); return; }
    if (exceedsStock) { setError("Not enough tickets remaining."); return; }

    setError("");
    setPhase("buying");
    setProgress({ current: 0, total: qty });
    let purchased = 0;

    try {
      let provider = new ethers.BrowserProvider(await wallet.getEthereumProvider());
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      // Buy on the chain the event was published to (so we hit the right deployment).
      const evChain = Number(ev.chainId);
      const targetChainId =
        (evChain === 31337 || evChain === 11155111) ? evChain
          : (currentChainId === 31337 || currentChainId === 11155111) ? currentChainId
          : 11155111;
      if (currentChainId !== targetChainId) {
        await wallet.switchChain(targetChainId);
        provider = new ethers.BrowserProvider(await wallet.getEthereumProvider());
      }

      const available = await findAvailableTickets(provider, ev);
      if (available.length < qty) {
        setError(available.length === 0
          ? "No tickets are available on-chain for this event yet. If you restarted your local node or redeployed the contract since publishing, re-publish the event from the organizer terminal."
          : `Only ${available.length} ticket(s) available right now — lower the quantity and try again.`);
        setPhase("idle");
        return;
      }
      const picks = available.slice(0, qty);

      // Funds check: sum of the ticket prices + a per-ticket gas buffer.
      // Demo mode: transactions execute with zero value, so we only need a gas buffer.
      const sumWei = picks.reduce((acc, p) => acc + p.price, 0n);
      const gasBufferWei = ethers.parseEther((0.0005 * qty).toFixed(6));
      const need = gasBufferWei; // Only require gas, not the ticket price
      const balance = await provider.getBalance(walletAddress);
      if (balance < need) {
        setError(`Insufficient funds for gas. You need ~${parseFloat(ethers.formatEther(need)).toFixed(4)} ETH to cover network fees but have ${parseFloat(ethers.formatEther(balance)).toFixed(4)} ETH.`);
        setPhase("idle");
        return;
      }

      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddressFor(targetChainId), CONTRACT_ABI, signer);
      const ids = picks.map((p) => p.id);

      // Prefer ONE combined transaction (batchPurchaseResale: mints/transfers all
      // requested tickets in a single block with the aggregate ETH value). Fall
      // back to per-ticket purchases only if the deployed contract predates it.
      let batchSupported = true;
      try {
        await contract.batchPurchaseResale.staticCall(ids, { value: 0n });
      } catch (probe) {
        if (probe?.reason) throw probe;   // a real revert reason → surface it
        batchSupported = false;           // function not present on this deployment
      }

      if (batchSupported) {
        setProgress({ current: 0, total: qty });
        const tx = await contract.batchPurchaseResale(ids, { value: 0n });
        await tx.wait();
        purchased = ids.length;
      } else {
        // Legacy fallback: one approval per ticket.
        for (let i = 0; i < picks.length; i++) {
          setProgress({ current: i + 1, total: qty });
          const tx = await contract.purchaseResaleTicket(picks[i].id, { value: 0n });
          await tx.wait();
          purchased++;
        }
      }

      // Atomically bump the off-chain sold counter by however many succeeded.
      await updateDoc(doc(db, "events", ev.id), {
        sold: increment(purchased),
        updatedAt: new Date().toISOString(),
      });

      setPhase("done");
      navigate("/wallet", { state: { purchased, eventTitle: ev.headline } });
    } catch (err) {
      console.error("Purchase failed:", err);
      const reason = err?.reason || err?.data?.message || err?.message || "Transaction failed";

      // Persist whatever succeeded before the failure so inventory stays accurate.
      if (purchased > 0) {
        try {
          await updateDoc(doc(db, "events", ev.id), { sold: increment(purchased), updatedAt: new Date().toISOString() });
        } catch (e) { console.warn("sold counter update failed:", e?.message); }
      }

      if (err?.code === "ACTION_REJECTED" || /rejected|denied/i.test(reason)) {
        setError(purchased > 0
          ? `You cancelled after buying ${purchased} of ${qty} ticket(s). The ${purchased} you confirmed are in your wallet.`
          : "You cancelled the transaction.");
      } else if (/insufficient funds/i.test(reason)) {
        setError(`Ran out of funds after ${purchased} ticket(s). Top up and buy the rest.`);
      } else {
        setError(`${reason}${purchased > 0 ? ` (bought ${purchased} of ${qty} before this)` : ""}`);
      }
      setPhase("idle");
    }
  };

  // ── States ──
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center text-slate-400">
        <RefreshCw className="w-8 h-8 mx-auto animate-spin mb-3" />
        <p className="text-sm">Loading event…</p>
      </div>
    );
  }

  if (notFound || !ev) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <CalendarX className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-slate-900">Event not found</h1>
        <p className="text-slate-500 text-sm mt-1">This event may have been removed.</p>
        <Link to="/" className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors">
          <ArrowLeft size={16} /> Back to events
        </Link>
      </div>
    );
  }

  const banner = ev.imageHash ? ipfsToHttp(ev.imageHash) : "";
  const canceled = status === EVENT_STATUS.CANCELED;
  const finished = status === EVENT_STATUS.FINISHED;
  const draftOrHidden = status === EVENT_STATUS.DRAFT || status === EVENT_STATUS.DELETED;
  const buying = phase === "buying";

  return (
    <div className="max-w-3xl mx-auto px-6 sm:px-8 py-10">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors mb-5">
        <ArrowLeft size={16} /> Back to events
      </Link>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="relative h-64 overflow-hidden bg-slate-100">
          {banner ? (
            <>
              <img src={banner} aria-hidden="true" className={`absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40 ${blocked ? "grayscale" : ""}`} />
              <img src={banner} alt={ev.headline} className={`relative w-full h-full object-contain ${blocked ? "grayscale opacity-70" : ""}`} />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300"><Ticket size={48} /></div>
          )}
          <div className="absolute top-4 left-4">
            {canceled ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-full shadow"><Ban size={13} /> Canceled</span>
            ) : finished ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 text-white text-xs font-semibold rounded-full shadow"><Clock size={13} /> Finished</span>
            ) : ev.category ? (
              <span className="inline-flex px-3 py-1.5 bg-white/90 backdrop-blur text-indigo-700 text-xs font-semibold rounded-full border border-indigo-200">{ev.category}</span>
            ) : null}
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{ev.headline}</h1>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 text-sm text-slate-500">
            <span className="inline-flex items-center gap-1.5"><Clock size={15} className="text-slate-400" /> {formatEventWindow(ev.timestamp)}</span>
            <span className="inline-flex items-center gap-1.5"><MapPin size={15} className="text-slate-400" /> {ev.venue || "Venue TBA"}</span>
          </div>

          {ev.description && <p className="mt-5 text-slate-600 leading-relaxed whitespace-pre-line">{ev.description}</p>}

          {(blocked || draftOrHidden) && (
            <div className={`mt-6 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${canceled ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>
                {canceled ? "This event has been canceled by the organizer. Ticket sales are closed."
                  : finished ? "This event has already taken place. Ticket sales are closed."
                  : "This event isn't available for purchase."}
              </span>
            </div>
          )}

          {/* Purchase box */}
          {!blocked && !draftOrHidden && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-5">
              {/* price + inventory */}
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-slate-500">Price per ticket</p>
                  <p className="text-2xl font-bold text-slate-900">{rm(price)}</p>
                  <p className="text-xs text-slate-400">{ethLabel(price, 3)}</p>
                </div>
                <p className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                  <Tag size={14} className="text-slate-400" />
                  {remaining > 0 ? <><span className="font-semibold text-slate-700">{remaining.toLocaleString()}</span>&nbsp;of {supply.toLocaleString()} left</> : "Sold out"}
                </p>
              </div>

              {/* quantity counter */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Quantity</span>
                <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <button
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={buying || qty <= 1}
                    className="px-3.5 py-2.5 text-slate-600 hover:bg-slate-50 disabled:text-slate-300 disabled:hover:bg-white transition-colors"
                    aria-label="Decrease quantity"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="w-12 text-center font-semibold text-slate-900 tabular-nums">{qty}</span>
                  <button
                    onClick={() => setQty((q) => Math.min(remaining, q + 1))}
                    disabled={buying || qty >= remaining}
                    className="px-3.5 py-2.5 text-slate-600 hover:bg-slate-50 disabled:text-slate-300 disabled:hover:bg-white transition-colors"
                    aria-label="Increase quantity"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {/* cost breakdown */}
              <div className="rounded-xl bg-white border border-slate-200 p-4 text-sm">
                <div className="flex items-center justify-between text-slate-600">
                  <span>{qty} × {rm(price)}</span>
                  <span>{rm(totalCost)}</span>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                  <span className="font-semibold text-slate-900">Total</span>
                  <span className="text-right">
                    <span className="block font-bold text-slate-900">{rm(totalCost)}</span>
                    <span className="block text-xs text-slate-400">{ethLabel(totalCost)} · plus gas</span>
                  </span>
                </div>
              </div>

              {exceedsStock && (
                <p className="text-sm text-red-600 font-medium">Not enough tickets remaining.</p>
              )}

              {buying && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <RefreshCw size={15} className="animate-spin text-indigo-600" />
                  {progress.current > 0
                    ? `Purchasing ticket ${progress.current} of ${progress.total}…`
                    : "Confirm the purchase in your wallet…"}
                </div>
              )}

              {!walletAddress ? (
                <button onClick={connectWallet} className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors">
                  Connect wallet to buy
                </button>
              ) : (
                <button
                  onClick={handleBuy}
                  disabled={buying || remaining <= 0 || exceedsStock}
                  className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2"
                >
                  {buying ? <><RefreshCw size={16} className="animate-spin" /> Processing…</>
                    : remaining <= 0 ? "Sold out"
                    : <><Ticket size={16} /> Confirm purchase · {rm(totalCost)}</>}
                </button>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
                </div>
              )}
            </div>
          )}

          <p className="mt-5 flex items-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck size={13} /> Tickets are minted on-chain to your wallet · resale capped at 110% of face value.
          </p>
        </div>
      </div>
    </div>
  );
}
