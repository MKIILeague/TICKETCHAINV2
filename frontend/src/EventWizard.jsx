import React, { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import {
  Calendar, MapPin, Tag, FileText, Hash, DollarSign, UploadCloud,
  Ticket as TicketIcon, RefreshCw, CheckCircle2, AlertCircle, X,
  Plus, Eye, Pencil, Trash2, ArrowLeft, Rocket, ExternalLink, Clock, Ban
} from "lucide-react";
import { CONTRACT_ABI, getContractAddress } from "./constants";
import { db } from "./firebase";
import { collection, addDoc, updateDoc, doc, getDocs, query, where } from "firebase/firestore";
import {
  uploadFileToIPFS, uploadJSONToIPFS, isIpfsConfigured, ipfsToHttp
} from "./ipfs";
import { EVENT_STATUS, effectiveStatus, cancelEvent, softDeleteEvent } from "./eventStatus";

const CATEGORIES = ["Concert", "Sports", "Theatre", "Conference"];
const USD_PER_ETH = 3500;
const usd = (eth) =>
  `$${(parseFloat(eth || 0) * USD_PER_ETH).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EMPTY = { headline: "", dateTime: "", category: "", venue: "", description: "", totalSupply: "", price: "" };

const STEPS = [
  { key: "ipfs", label: "Uploading to IPFS" },
  { key: "chain", label: "Minting on-chain" },
  { key: "sync", label: "Publishing event" },
];

// UNIX seconds -> value for <input type="datetime-local"> in local time.
function unixToLocalInput(unixSec) {
  if (!unixSec) return "";
  const d = new Date(unixSec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatEventDate(unixSec) {
  if (!unixSec) return "Date TBA";
  return new Date(unixSec * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Draft → Preview → Edit/Publish event wizard.
 *  - Save Draft  → Firestore /events/{id} with status:"draft" (banner pinned to IPFS)
 *  - Preview     → buyer-facing mock-up of the event page
 *  - Publish     → IPFS metadata → batchMintTickets → mutate status:"published"
 */
export default function EventWizard({ wallet, walletAddress, orgData, isPaused, activeChainId, onPublished }) {
  const [view, setView] = useState("list"); // list | edit | preview
  const [events, setEvents] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  const [form, setForm] = useState(EMPTY);
  const [posterFile, setPosterFile] = useState(null);   // newly picked, not yet pinned
  const [posterPreview, setPosterPreview] = useState(""); // object URL or gateway URL
  const [currentId, setCurrentId] = useState(null);      // Firestore doc id (null = new)
  const [currentImageHash, setCurrentImageHash] = useState(""); // already-pinned CID

  const [error, setError] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | saving | ipfs | chain | sync | done | error
  const busy = ["saving", "ipfs", "chain", "sync"].includes(phase);
  const fileRef = useRef(null);

  // Cancel-event confirmation modal
  const [cancelTarget, setCancelTarget] = useState(null);
  const [canceling, setCanceling] = useState(false);

  // Five-state partitioning (deleted events are hidden everywhere).
  const visible = events.filter((e) => e.status !== EVENT_STATUS.DELETED);
  const drafts = visible.filter((e) => e.status === EVENT_STATUS.DRAFT);
  const live = visible.filter((e) => effectiveStatus(e) === EVENT_STATUS.PUBLISHED);
  const finished = visible.filter((e) => effectiveStatus(e) === EVENT_STATUS.FINISHED);
  const canceled = visible.filter((e) => e.status === EVENT_STATUS.CANCELED);

  // ── Load this organiser's events ──
  const loadEvents = async () => {
    if (!walletAddress) return;
    setLoadingList(true);
    try {
      const q = query(collection(db, "events"), where("organiserId", "==", walletAddress));
      const snap = await getDocs(q);
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
      setEvents(list);
    } catch (err) {
      console.error("Load events failed:", err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => { loadEvents(); /* eslint-disable-next-line */ }, [walletAddress]);

  // ── Form helpers ──
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError(""); };

  const clearPoster = () => {
    setPosterFile(null);
    setPosterPreview("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const resetForm = () => {
    setForm(EMPTY);
    setCurrentId(null);
    setCurrentImageHash("");
    clearPoster();
    setError("");
  };

  const newEvent = () => { resetForm(); setView("edit"); };

  const editEvent = (ev) => {
    setForm({
      headline: ev.headline || "",
      dateTime: unixToLocalInput(ev.timestamp),
      category: ev.category || "",
      venue: ev.venue || "",
      description: ev.description || "",
      totalSupply: ev.aggregateSupply != null ? String(ev.aggregateSupply) : "",
      price: ev.priceEth != null ? String(ev.priceEth) : "",
    });
    setCurrentId(ev.id);
    setCurrentImageHash(ev.imageHash || "");
    setPosterFile(null);
    setPosterPreview(ev.imageHash ? ipfsToHttp(ev.imageHash) : "");
    setError("");
    setView("edit");
  };

  const onPickPoster = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Poster must be an image file."); return; }
    setPosterFile(file);
    setPosterPreview(URL.createObjectURL(file));
    setError("");
  };

  // Full validation (required for Preview & Publish).
  const validateFull = () => {
    if (!form.headline.trim()) return "Add an event title.";
    if (!form.dateTime) return "Pick a date & time.";
    if (!form.category) return "Choose a category.";
    if (!form.venue.trim()) return "Add a venue name & location.";
    if (!posterFile && !currentImageHash) return "Upload an event poster image.";
    const supply = parseInt(form.totalSupply, 10);
    if (!Number.isInteger(supply) || supply <= 0) return "Total quantity must be a whole number greater than 0.";
    if (!(parseFloat(form.price) > 0)) return "Ticket price must be greater than 0.";
    if (!isIpfsConfigured()) return "IPFS isn't configured — add VITE_PINATA_JWT to frontend/.env (see .env.example).";
    return null;
  };

  // Pin the poster if a new file was picked; otherwise reuse the stored CID.
  const ensureImageUploaded = async () => {
    if (posterFile) {
      const cid = await uploadFileToIPFS(posterFile, `${form.headline || "event"} — poster`);
      setCurrentImageHash(cid);
      setPosterFile(null);
      setPosterPreview(ipfsToHttp(cid));
      return cid;
    }
    return currentImageHash || "";
  };

  // Upsert the draft doc. Returns { id, imageHash }. Does not touch `view`.
  const persistDraft = async () => {
    const imageHash = await ensureImageUploaded();
    const ts = form.dateTime ? Math.floor(new Date(form.dateTime).getTime() / 1000) : null;
    const now = new Date().toISOString();
    const payload = {
      organiserId: walletAddress,
      organiserName: orgData?.organizationName || "",
      headline: form.headline.trim(),
      timestamp: ts,
      category: form.category || "",
      venue: form.venue.trim(),
      description: form.description.trim(),
      aggregateSupply: form.totalSupply ? parseInt(form.totalSupply, 10) : null,
      priceEth: form.price || null,
      imageHash: imageHash || null,
      status: "draft",
      updatedAt: now,
    };
    let id = currentId;
    if (id) {
      await updateDoc(doc(db, "events", id), payload);
    } else {
      payload.createdAt = now;
      const ref = await addDoc(collection(db, "events"), payload);
      id = ref.id;
      setCurrentId(id);
    }
    return { id, imageHash };
  };

  // ── Save Draft button ──
  const handleSaveDraft = async ({ goPreview = false } = {}) => {
    if (busy) return;
    if (goPreview) {
      const v = validateFull();
      if (v) { setError(v); return; }
    } else if (!form.headline.trim()) {
      setError("Add at least a title to save a draft.");
      return;
    }
    setPhase("saving");
    setError("");
    try {
      await persistDraft();
      await loadEvents();
      setPhase("idle");
      setView(goPreview ? "preview" : "list");
    } catch (err) {
      console.error("Save draft failed:", err);
      setPhase("error");
      setError(/Pinata|IPFS/i.test(err?.message) ? `IPFS upload failed: ${err.message}` : (err?.message || "Couldn't save draft."));
    }
  };

  // ── Publish (the heavy web3 pipeline) ──
  const handlePublish = async () => {
    if (busy) return;
    const v = validateFull();
    if (v) { setError(v); return; }
    if (!wallet || !walletAddress) { setError("Connect your wallet first."); return; }

    const quantity = parseInt(form.totalSupply, 10);
    const ts = Math.floor(new Date(form.dateTime).getTime() / 1000);
    let diagChainId = null, diagContract = null;

    try {
      // ── Step A — IPFS payload (pin poster if needed, then metadata) ─────────
      setPhase("ipfs");
      setError("");
      const { id, imageHash } = await persistDraft(); // ensures doc id + pinned poster
      const metadata = {
        name: form.headline.trim(),
        description: form.description.trim(),
        image: `ipfs://${imageHash}`,
        attributes: [
          { trait_type: "Category", value: form.category },
          { trait_type: "Venue", value: form.venue.trim() },
          { trait_type: "Event date", value: ts, display_type: "date" },
        ],
      };
      const metadataCid = await uploadJSONToIPFS(metadata, `${form.headline.trim()} — metadata`);
      const tokenURI = `ipfs://${metadataCid}`;

      // ── Step B — Blockchain minting ─────────────────────────────────────────
      setPhase("chain");
      let eip1193Provider = await wallet.getEthereumProvider();
      let provider = new ethers.BrowserProvider(eip1193Provider);

      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      const targetChainId = (currentChainId === 31337 || currentChainId === 11155111) ? currentChainId : 11155111;
      if (currentChainId !== targetChainId) {
        await wallet.switchChain(targetChainId);
        eip1193Provider = await wallet.getEthereumProvider();
        provider = new ethers.BrowserProvider(eip1193Provider);
      }

      try {
        const bal = await provider.getBalance(walletAddress);
        if (parseFloat(ethers.formatEther(bal)) < 0.0005) {
          const proceed = window.confirm("⚠️ Low balance\n\nYour wallet has very little ETH, which may not cover gas. Continue anyway?");
          if (!proceed) { setPhase("idle"); return; }
        }
      } catch { /* best-effort */ }

      const signer = await provider.getSigner();
      const contractAddress = getContractAddress(targetChainId);
      diagChainId = targetChainId; diagContract = contractAddress;
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
      const priceInWei = ethers.parseEther(String(form.price)); // permanent face value (110% resale floor)

      try {
        await contract.batchMintTickets.staticCall(walletAddress, tokenURI, priceInWei, form.headline.trim(), quantity);
      } catch (pf) {
        console.warn("[publish] mint preflight (non-blocking):", pf?.reason || pf?.shortMessage || pf?.message);
      }

      const gasLimit = 150000n + 320000n * BigInt(quantity);
      const tx = await contract.batchMintTickets(walletAddress, tokenURI, priceInWei, form.headline.trim(), quantity, { gasLimit });
      const receipt = await tx.wait();

      // ── Step C — Firestore mutation: draft → published ──────────────────────
      setPhase("sync");
      await updateDoc(doc(db, "events", id), {
        status: "published",
        ipfsHash: metadataCid,
        contractAddress,
        txHash: receipt?.hash || tx.hash,
        chainId: targetChainId,
        timestamp: ts,
        aggregateSupply: quantity,
        priceEth: form.price,
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      setPhase("done");
      onPublished?.();
      await loadEvents();
      alert(`✅ Published "${form.headline.trim()}" — minted ${quantity} ticket(s).\nMetadata CID: ${metadataCid}`);
      resetForm();
      setView("list");
      setTimeout(() => setPhase("idle"), 1200);
    } catch (err) {
      console.error("Publish failed:", err);
      setPhase("error");
      const reason = err?.reason || err?.data?.message || err?.message || "Unknown error";
      if (err?.code === "ACTION_REJECTED" || /rejected|denied/i.test(reason)) {
        setError("You cancelled the transaction. The event is still a draft.");
      } else if (/not whitelisted|organizer|caller/i.test(reason)) {
        setError(`Your wallet isn't whitelisted as an organizer on this contract. Ask the admin to whitelist: ${walletAddress}`);
      } else if (/missing revert data|CALL_EXCEPTION|no matching/i.test(reason)) {
        const net = diagChainId === 31337 ? "Localhost 31337" : diagChainId === 11155111 ? "Sepolia" : `chain ${diagChainId}`;
        setError(`The contract rejected the mint (no reason returned). Most likely your wallet isn't whitelisted on ${net} (${diagContract}).`);
      } else if (/insufficient funds/i.test(reason)) {
        setError("Not enough ETH to cover gas. Fund your wallet and try again.");
      } else if (/Pinata|IPFS/i.test(reason)) {
        setError(`IPFS upload failed: ${reason}`);
      } else {
        setError(reason);
      }
    }
  };

  // Soft-delete a draft or canceled event: flip status to "deleted"
  // (kept in Firestore for audit, hidden from every dashboard).
  const handleDelete = async (ev) => {
    if (!window.confirm(`Delete "${ev.headline || "Untitled"}"? It will be removed from your dashboards (kept in our records for audit).`)) return;
    try {
      await softDeleteEvent(ev.id);
      setEvents((prev) => prev.filter((e) => e.id !== ev.id));
    } catch (err) {
      console.error("Delete failed:", err);
      alert(err?.message || "Couldn't delete draft.");
    }
  };

  // Emergency-cancel a published event (freezes buy/transfer/entry, client-side).
  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCanceling(true);
    try {
      await cancelEvent(cancelTarget.id);
      setEvents((prev) => prev.map((e) => (e.id === cancelTarget.id ? { ...e, status: EVENT_STATUS.CANCELED } : e)));
      onPublished?.(); // refresh parent dashboard analytics
      setCancelTarget(null);
    } catch (err) {
      console.error("Cancel failed:", err);
      alert(err?.message || "Couldn't cancel event.");
    } finally {
      setCanceling(false);
    }
  };

  // ── Shared field styles ──
  const inputCls = "w-full bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all disabled:opacity-50 disabled:bg-slate-50";
  const labelCls = "flex items-center gap-2 text-sm font-medium text-slate-700 mb-1.5";
  const currentStepIdx = STEPS.findIndex((s) => s.key === phase);

  // ───────────────────────────── LIST VIEW ─────────────────────────────
  if (view === "list") {
    return (
      <div className="max-w-5xl space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Events</h2>
            <p className="text-slate-500 mt-1 text-sm">Draft, preview, then publish on-chain.</p>
          </div>
          <button onClick={newEvent} className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors shrink-0">
            <Plus size={16} /> New event
          </button>
        </div>

        {!isIpfsConfigured() && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>IPFS isn't configured. Add <code className="font-mono">VITE_PINATA_JWT</code> to <code className="font-mono">frontend/.env</code> and restart the dev server before publishing.</span>
          </div>
        )}

        {/* Drafts */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-base font-semibold text-slate-900">Drafts</h3>
            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 text-sm font-semibold rounded-full">{drafts.length}</span>
            <button onClick={loadEvents} disabled={loadingList} className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors" title="Refresh">
              <RefreshCw size={15} className={loadingList ? "animate-spin" : ""} />
            </button>
          </div>
          {drafts.length === 0 ? (
            <div className="border border-dashed border-slate-300 rounded-2xl p-12 text-center bg-white">
              <TicketIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600 font-semibold">No drafts yet</p>
              <p className="text-slate-400 text-sm mt-1">Click “New event” to create one.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {drafts.map((ev) => (
                <div key={ev.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                  <div className="h-28 bg-slate-100 relative">
                    {ev.imageHash
                      ? <img src={ipfsToHttp(ev.imageHash)} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-slate-300"><TicketIcon size={26} /></div>}
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-1 text-xs font-semibold">
                      <Pencil size={11} /> Draft
                    </span>
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <h4 className="font-semibold text-slate-900 truncate">{ev.headline || "Untitled event"}</h4>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5"><Clock size={12} /> {formatEventDate(ev.timestamp)}</p>
                    <div className="flex gap-2 mt-4">
                      <button onClick={() => editEvent(ev)} className="flex-1 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-semibold transition-colors inline-flex items-center justify-center gap-1.5">
                        <Pencil size={14} /> Edit
                      </button>
                      <button onClick={() => handleDelete(ev)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete draft">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Published (live) — with Manage / Cancel */}
        {live.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-base font-semibold text-slate-900">Published</h3>
              <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 text-sm font-semibold rounded-full">{live.length}</span>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
              {live.map((ev) => (
                <div key={ev.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><CheckCircle2 size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 truncate">{ev.headline}</p>
                    <p className="text-xs text-slate-400">{ev.aggregateSupply} tickets · {ev.priceEth} ETH · {formatEventDate(ev.timestamp)}</p>
                  </div>
                  {ev.txHash && ev.chainId === 11155111 && (
                    <a href={`https://sepolia.etherscan.io/tx/${ev.txHash}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1 shrink-0">
                      Tx <ExternalLink size={12} />
                    </a>
                  )}
                  <button onClick={() => setCancelTarget(ev)} className="text-xs font-semibold text-red-600 hover:text-red-700 border border-red-200 hover:bg-red-50 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5 shrink-0 transition-colors">
                    <Ban size={13} /> Cancel
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Canceled */}
        {canceled.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-base font-semibold text-slate-900">Canceled</h3>
              <span className="px-2.5 py-0.5 bg-red-50 text-red-700 text-sm font-semibold rounded-full">{canceled.length}</span>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
              {canceled.map((ev) => (
                <div key={ev.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0"><Ban size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 truncate">{ev.headline}</p>
                    <p className="text-xs text-slate-400">Canceled · {formatEventDate(ev.timestamp)}</p>
                  </div>
                  <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-1 shrink-0">Frozen</span>
                  <button onClick={() => handleDelete(ev)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0" title="Delete event">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Past events (finished) */}
        {finished.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-base font-semibold text-slate-900">Past events</h3>
              <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 text-sm font-semibold rounded-full">{finished.length}</span>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
              {finished.map((ev) => (
                <div key={ev.id} className="flex items-center gap-4 px-5 py-4 opacity-80">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><Clock size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-700 truncate">{ev.headline}</p>
                    <p className="text-xs text-slate-400">Finished · {formatEventDate(ev.timestamp)}</p>
                  </div>
                  <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-2.5 py-1 shrink-0">Archived</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Cancel confirmation modal */}
        {cancelTarget && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[1000]" onClick={() => !canceling && setCancelTarget(null)}>
            <div onClick={(e) => e.stopPropagation()} className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0"><Ban size={20} /></div>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-slate-900 leading-tight">Cancel this event?</h3>
                  <p className="text-sm text-slate-500 truncate">{cancelTarget.headline}</p>
                </div>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed mb-5">
                This badges the event <span className="font-semibold text-red-700">Canceled</span> for buyers and immediately
                <span className="font-medium text-slate-700"> freezes marketplace trading</span> (no primary sales or secondary
                transfers) and makes the gate scanner deny entry. Already-minted tickets stay in buyers' wallets. This can't be undone here.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setCancelTarget(null)} disabled={canceling} className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-xl font-semibold text-sm transition-colors">
                  Keep event
                </button>
                <button onClick={confirmCancel} disabled={canceling} className="flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2">
                  {canceling ? <><RefreshCw size={15} className="animate-spin" /> Canceling…</> : <><Ban size={15} /> Cancel event</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ───────────────────────────── PREVIEW VIEW ──────────────────────────
  if (view === "preview") {
    const banner = posterPreview || (currentImageHash ? ipfsToHttp(currentImageHash) : "");
    const qty = parseInt(form.totalSupply, 10) || 0;
    return (
      <div className="max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => setView("list")} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
            <ArrowLeft size={16} /> Back to events
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 text-xs font-semibold">
            <Eye size={13} /> Buyer preview — not published
          </span>
        </div>

        {/* Buyer-facing mock-up */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-56 bg-slate-100 relative">
            {banner
              ? <img src={banner} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-slate-300"><TicketIcon size={40} /></div>}
            {form.category && (
              <span className="absolute top-3 left-3 inline-flex px-2.5 py-1 bg-white/90 backdrop-blur text-indigo-700 text-xs font-semibold rounded-full border border-indigo-200">
                {form.category}
              </span>
            )}
          </div>
          <div className="p-6">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{form.headline || "Untitled event"}</h1>
            <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Clock size={15} className="text-slate-400" /> {formatEventDate(form.dateTime ? Math.floor(new Date(form.dateTime).getTime() / 1000) : null)}</span>
              <span className="inline-flex items-center gap-1.5"><MapPin size={15} className="text-slate-400" /> {form.venue || "Venue TBA"}</span>
            </div>

            {form.description && <p className="mt-4 text-slate-600 leading-relaxed whitespace-pre-line">{form.description}</p>}

            <div className="flex items-end justify-between mt-6 pt-5 border-t border-slate-100">
              <div>
                <p className="text-xs text-slate-500">From</p>
                <p className="text-2xl font-bold text-slate-900">{form.price ? parseFloat(form.price).toFixed(3) : "0.000"} <span className="text-base font-medium text-slate-400">ETH</span></p>
                <p className="text-xs text-slate-400">≈ {usd(form.price)} · {qty} available</p>
              </div>
              <button disabled className="px-6 py-3 bg-indigo-600/60 text-white rounded-xl font-semibold text-sm cursor-not-allowed inline-flex items-center gap-2">
                <TicketIcon size={16} /> Buy ticket
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}

        {(busy || phase === "done") && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
            {STEPS.map((s, i) => {
              const done = phase === "done" || i < currentStepIdx;
              const active = i === currentStepIdx && phase !== "done";
              return (
                <div key={s.key} className="flex items-center gap-3 text-sm">
                  {done ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                    : active ? <RefreshCw size={18} className="text-indigo-600 animate-spin shrink-0" />
                    : <span className="w-[18px] h-[18px] rounded-full border-2 border-slate-300 shrink-0" />}
                  <span className={done ? "text-slate-500" : active ? "text-slate-900 font-medium" : "text-slate-400"}>{s.label}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={() => setView("edit")} disabled={busy} className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-xl font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2">
            <Pencil size={16} /> Edit event
          </button>
          <button onClick={handlePublish} disabled={busy || isPaused} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2">
            {busy ? <><RefreshCw size={15} className="animate-spin" /> Publishing…</> : isPaused ? "Transactions paused" : <><Rocket size={16} /> Publish event</>}
          </button>
        </div>
      </div>
    );
  }

  // ───────────────────────────── EDIT VIEW ─────────────────────────────
  return (
    <div className="max-w-2xl space-y-5">
      <button onClick={() => setView("list")} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
        <ArrowLeft size={16} /> Back to events
      </button>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">{currentId ? "Edit event" : "New event"}</h2>
        <p className="text-sm text-slate-500 mb-5">Fill in the details, save a draft, then preview before publishing.</p>

        {!isIpfsConfigured() && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>IPFS isn't configured. Add <code className="font-mono">VITE_PINATA_JWT</code> to <code className="font-mono">frontend/.env</code> and restart the dev server.</span>
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label className={labelCls}><TicketIcon size={15} className="text-indigo-600" /> Headline / title *</label>
            <input type="text" value={form.headline} onChange={set("headline")} disabled={busy} placeholder="e.g. Ethereum Lisbon 2026" className={inputCls} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}><Calendar size={15} className="text-indigo-600" /> Date & time *</label>
              <input type="datetime-local" value={form.dateTime} onChange={set("dateTime")} disabled={busy} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}><Tag size={15} className="text-indigo-600" /> Category *</label>
              <select value={form.category} onChange={set("category")} disabled={busy} className={inputCls}>
                <option value="" disabled>Select category…</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}><MapPin size={15} className="text-indigo-600" /> Venue name & location *</label>
            <input type="text" value={form.venue} onChange={set("venue")} disabled={busy} placeholder="e.g. LX Factory, Lisbon" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}><UploadCloud size={15} className="text-indigo-600" /> Event poster / banner *</label>
            {posterPreview ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200">
                <img src={posterPreview} alt="Poster preview" className="w-full h-40 object-cover" />
                <button type="button" onClick={clearPoster} disabled={busy} className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-white/90 border border-slate-200 flex items-center justify-center text-slate-600 hover:text-red-600 transition-colors">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center gap-2 h-32 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 transition-colors ${busy ? "opacity-50" : "cursor-pointer hover:border-indigo-400 hover:text-indigo-500"}`}>
                <UploadCloud size={22} />
                <span className="text-sm">Click to upload an image</span>
                <input ref={fileRef} type="file" accept="image/*" onChange={onPickPoster} disabled={busy} className="hidden" />
              </label>
            )}
          </div>

          <div>
            <label className={labelCls}><FileText size={15} className="text-indigo-600" /> Detailed description</label>
            <textarea rows={3} value={form.description} onChange={set("description")} disabled={busy} placeholder="What attendees can expect, perks, line-up…" className={`${inputCls} resize-none`} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}><Hash size={15} className="text-indigo-600" /> Total quantity *</label>
              <input type="number" min="1" step="1" value={form.totalSupply} onChange={set("totalSupply")} disabled={busy} placeholder="500" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}><DollarSign size={15} className="text-indigo-600" /> Ticket price (ETH) *</label>
              <input type="number" min="0" step="any" value={form.price} onChange={set("price")} disabled={busy} placeholder="0.05" className={inputCls} />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button onClick={() => handleSaveDraft({ goPreview: false })} disabled={busy} className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-xl font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2">
              {phase === "saving" ? <><RefreshCw size={15} className="animate-spin" /> Saving…</> : "Save draft"}
            </button>
            <button onClick={() => handleSaveDraft({ goPreview: true })} disabled={busy} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2">
              <Eye size={16} /> Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
