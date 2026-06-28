import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  ShieldAlert, UserMinus, Activity,
  BarChart3, Lock, Unlock, RefreshCw, CheckCircle2,
  XCircle, Clock, Building2, Mail, Tag, User, Eye,
  Search, AlertTriangle, Info, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { CONTRACT_ABI, getContractAddress } from "./constants";
import { db } from "./firebase";
import {
  collection, getDocs, doc, updateDoc, serverTimestamp, query, orderBy
} from "firebase/firestore";

// ─── Toast system (replaces blocking alert() calls) ──────────────────────────
let toastSeq = 0;
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);
  const push = useCallback((type, message) => {
    const id = ++toastSeq;
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => dismiss(id), 5000);
    return id;
  }, [dismiss]);
  return { toasts, push, dismiss };
}

const ToastStack = ({ toasts, dismiss }) => {
  const config = {
    success: { icon: CheckCircle2, ring: "border-emerald-200", bg: "bg-emerald-50", text: "text-emerald-700", iconColor: "text-emerald-500" },
    error: { icon: AlertTriangle, ring: "border-red-200", bg: "bg-red-50", text: "text-red-700", iconColor: "text-red-500" },
    info: { icon: Info, ring: "border-indigo-200", bg: "bg-indigo-50", text: "text-indigo-700", iconColor: "text-indigo-500" },
  };
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3 w-[min(92vw,22rem)]">
      <AnimatePresence>
        {toasts.map(t => {
          const c = config[t.type] || config.info;
          const Icon = c.icon;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              className={`${c.bg} border ${c.ring} rounded-2xl shadow-lg p-4 flex items-start gap-3`}
            >
              <Icon size={18} className={`${c.iconColor} shrink-0 mt-0.5`} />
              <p className={`text-xs font-semibold leading-relaxed ${c.text} flex-1 break-words`}>{t.message}</p>
              <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-700 transition-colors shrink-0">
                <X size={15} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

const SystemAdminConsole = ({ walletAddress, wallet, connectWallet }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [organisers, setOrganisers] = useState([]);
  const [platformBalance, setPlatformBalance] = useState("0.0");
  const [activeTab, setActiveTab] = useState("pending");
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // orgId being processed
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [search, setSearch] = useState("");

  const { toasts, push, dismiss } = useToasts();

  // ── Fetch Firestore organisers ──
  const fetchOrganisers = async () => {
    try {
      const q = query(collection(db, "organisers"), orderBy("submittedAt", "desc"));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setOrganisers(list);
    } catch (err) {
      console.error("Firestore fetch failed:", err);
      push("error", "Failed to load organiser applications.");
    }
  };

  // ── Fetch on-chain data ──
  const fetchChainData = async () => {
    if (!wallet || !walletAddress) return;
    try {
      const eip1193Provider = await wallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(eip1193Provider);
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      const contractAddress = getContractAddress(currentChainId);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);
      const paused = await contract.paused();
      setIsPaused(paused);
      const balance = await provider.getBalance(contractAddress);
      setPlatformBalance(ethers.formatEther(balance));
    } catch (err) {
      console.error("Chain fetch error:", err);
    }
  };

  // ── Combined refresh (used on mount + manual button) ──
  const refreshAll = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    await Promise.all([fetchOrganisers(), fetchChainData()]);
    setLastUpdated(new Date());
    setRefreshing(false);
    setInitialLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  // Depend on the stable address string, not the `wallet` object (its identity
  // changes every render, which caused an infinite fetch/abort loop).
  useEffect(() => {
    refreshAll({ silent: true });
  }, [walletAddress, refreshAll]);

  // ── Approve: Firestore + on-chain whitelist ──
  const handleApprove = async (org) => {
    setActionLoading(org.id);
    try {
      if (!wallet) {
        push("error", "Please connect your admin wallet first.");
        setActionLoading(null);
        return;
      }

      // Whitelist organizer on-chain first
      const eip1193Provider = await wallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(eip1193Provider);
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      const contractAddress = getContractAddress(currentChainId);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

      const tx = await contract.whitelistOrganizer(org.id);
      await tx.wait();

      // Update Firestore
      await updateDoc(doc(db, "organisers", org.id), {
        status: "approved",
        reviewedAt: new Date().toISOString(),
      });

      await fetchOrganisers();
      setSelectedOrg(null);
      push("success", `${org.organizationName} approved and whitelisted on-chain.`);
    } catch (err) {
      console.error("Approval failed:", err);
      push("error", `Approval failed: ${err.reason || err.message || "Unknown error"}`);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Sync Whitelist (Force whitelist de-synced approved organizers on-chain) ──
  const handleWhitelistOnly = async (org) => {
    setActionLoading(org.id);
    try {
      if (!wallet) {
        push("error", "Please connect your admin wallet first.");
        setActionLoading(null);
        return;
      }
      const eip1193Provider = await wallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(eip1193Provider);
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      const contractAddress = getContractAddress(currentChainId);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

      const tx = await contract.whitelistOrganizer(org.id);
      await tx.wait();
      push("success", `${org.organizationName} whitelisted on-chain.`);
    } catch (err) {
      console.error("Whitelisting failed:", err);
      push("error", `Whitelisting failed: ${err.reason || err.message || "Unknown error"}`);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Reject: Firestore only ──
  const handleReject = async (org) => {
    if (!window.confirm(`Reject application from ${org.organizationName}?`)) return;
    setActionLoading(org.id);
    try {
      await updateDoc(doc(db, "organisers", org.id), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
      });
      await fetchOrganisers();
      setSelectedOrg(null);
      push("info", `${org.organizationName} application rejected.`);
    } catch (err) {
      console.error("Rejection failed:", err);
      push("error", "Rejection failed. Please try again.");
    } finally {
      setActionLoading(null);
    }
  };

  // ── Revoke: on-chain revoke + Firestore update ──
  const handleRevoke = async (org) => {
    if (!window.confirm(`Revoke access for ${org.organizationName}?`)) return;
    setActionLoading(org.id);
    try {
      if (!wallet) {
        push("error", "Please connect your admin wallet first.");
        setActionLoading(null);
        return;
      }

      // Revoke organizer on-chain first
      const eip1193Provider = await wallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(eip1193Provider);
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      const contractAddress = getContractAddress(currentChainId);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

      const tx = await contract.revokeOrganizer(org.id);
      await tx.wait();

      // Update Firestore
      await updateDoc(doc(db, "organisers", org.id), {
        status: "rejected",
        reviewedAt: new Date().toISOString(),
      });
      await fetchOrganisers();
      push("info", `Access revoked for ${org.organizationName}.`);
    } catch (err) {
      console.error("Revoke failed:", err);
      push("error", `Revoke failed: ${err.reason || err.message || "Unknown error"}`);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Circuit breaker ──
  const handleTogglePause = async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const eip1193Provider = await wallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(eip1193Provider);
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      const contractAddress = getContractAddress(currentChainId);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
      const tx = isPaused ? await contract.unpause() : await contract.pause();
      await tx.wait();
      setIsPaused(!isPaused);
      push(isPaused ? "success" : "info", isPaused ? "Protocol resumed." : "Protocol frozen. All minting/transfers halted.");
    } catch (err) {
      console.error("Circuit breaker failed:", err);
      push("error", err.reason || "Unauthorized: Only Owner can toggle.");
    } finally {
      setLoading(false);
    }
  };

  const pending = organisers.filter(o => o.status === "pending");
  const approved = organisers.filter(o => o.status === "approved");
  const rejected = organisers.filter(o => o.status === "rejected");

  const tabData = { pending, approved, rejected };

  // Apply search filter to the active list
  const q = search.trim().toLowerCase();
  const currentList = (tabData[activeTab] || []).filter(o => {
    if (!q) return true;
    return [o.organizationName, o.legalName, o.email, o.eventType, o.walletAddress]
      .some(v => (v || "").toLowerCase().includes(q));
  });

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-4 flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-red-600 rounded-2xl flex items-center justify-center shadow-lg shadow-red-500/20 rotate-3 shrink-0">
              <ShieldAlert className="text-white w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tighter uppercase">Admin Console</h1>
              <p className="text-[11px] text-slate-500 font-mono flex items-center gap-2 truncate">
                <Activity size={12} className={isPaused ? "text-red-500" : "text-emerald-500 animate-pulse"} />
                Runtime: {isPaused ? "FROZEN" : "Healthy"}
                {walletAddress && <span className="hidden sm:inline">· {walletAddress.substring(0, 14)}…</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {!walletAddress && (
              <button onClick={connectWallet} className="px-4 sm:px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg transition-all">
                Connect Wallet
              </button>
            )}
            <button
              onClick={() => refreshAll()}
              disabled={refreshing}
              title="Refresh data"
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <div className={`px-3 sm:px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest ${isPaused ? "bg-red-50 border-red-200 text-red-600" : "bg-emerald-50 border-emerald-200 text-emerald-600"}`}>
              {isPaused ? "⚠ Frozen" : "● Operational"}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 sm:p-8 space-y-6 sm:space-y-8">

        {/* Last updated */}
        <p className="text-[10px] text-slate-600 font-mono">
          {lastUpdated
            ? `Last updated ${lastUpdated.toLocaleTimeString()}`
            : "Loading data…"}
        </p>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {initialLoading ? (
            <>{[0, 1, 2, 3].map(i => <StatSkeleton key={i} />)}</>
          ) : (
            <>
              <MiniStat label="Pending Review" value={pending.length} color="amber" icon={<Clock size={18} />} />
              <MiniStat label="Approved" value={approved.length} color="emerald" icon={<CheckCircle2 size={18} />} />
              <MiniStat label="Rejected" value={rejected.length} color="red" icon={<XCircle size={18} />} />
              <MiniStat label="Contract ETH" value={`${parseFloat(platformBalance).toFixed(3)}`} color="indigo" icon={<BarChart3 size={18} />} suffix="ETH" />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">

          {/* ── Organiser Applications Panel ── */}
          <div className="lg:col-span-8 space-y-5">

            {/* Pending alert banner */}
            {pending.length > 0 && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3">
                <Clock size={18} className="text-amber-500 animate-pulse shrink-0" />
                <p className="text-amber-700 text-sm font-bold">
                  {pending.length} application{pending.length > 1 ? "s" : ""} awaiting your review
                </p>
              </motion.div>
            )}

            {/* Search */}
            <div className="relative">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, email, event type, or wallet…"
                className="w-full bg-white border border-slate-200 rounded-2xl pl-11 pr-10 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors">
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Tabs */}
            <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
              <div className="flex border-b border-slate-200">
                {["pending", "approved", "rejected"].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-4 text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${activeTab === tab
                      ? tab === "pending" ? "bg-amber-50 text-amber-600 border-b-2 border-amber-500"
                        : tab === "approved" ? "bg-emerald-50 text-emerald-600 border-b-2 border-emerald-500"
                          : "bg-red-50 text-red-600 border-b-2 border-red-500"
                      : "text-slate-500 hover:text-slate-900"}`}
                  >
                    {tab === "pending" && <Clock size={14} />}
                    {tab === "approved" && <CheckCircle2 size={14} />}
                    {tab === "rejected" && <XCircle size={14} />}
                    <span>{tab} ({tabData[tab].length})</span>
                  </button>
                ))}
              </div>

              {/* List */}
              <div className="divide-y divide-slate-200">
                {initialLoading ? (
                  <>{[0, 1, 2].map(i => <RowSkeleton key={i} />)}</>
                ) : currentList.length === 0 ? (
                  <div className="p-16 text-center text-slate-400">
                    <Building2 size={48} className="mx-auto mb-4 opacity-30" />
                    <p className="text-sm font-bold">
                      {q ? `No ${activeTab} applications match "${search}"` : `No ${activeTab} applications`}
                    </p>
                  </div>
                ) : (
                  currentList.map(org => (
                    <motion.div
                      key={org.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-4 sm:p-6 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div className="flex items-start gap-4 min-w-0">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${activeTab === "pending" ? "bg-amber-50 text-amber-600" : activeTab === "approved" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
                            <Building2 size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-slate-900 font-bold text-sm">{org.organizationName}</h4>
                              <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${activeTab === "pending" ? "bg-amber-50 text-amber-600 border-amber-200" : activeTab === "approved" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"}`}>
                                {org.status}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                              <span className="text-xs text-slate-600 flex items-center gap-1"><User size={11} className="text-slate-400" />{org.legalName}</span>
                              <span className="text-xs text-slate-600 flex items-center gap-1"><Mail size={11} className="text-slate-400" />{org.email}</span>
                              <span className="text-xs text-slate-600 flex items-center gap-1"><Tag size={11} className="text-slate-400" />{org.eventType}</span>
                            </div>
                            <p className="text-[10px] font-mono text-slate-400 mt-1 break-all">{org.walletAddress}</p>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 shrink-0 flex-wrap sm:justify-end">
                          <button
                            onClick={() => setSelectedOrg(selectedOrg?.id === org.id ? null : org)}
                            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 rounded-xl transition-all"
                            title="View details"
                          >
                            <Eye size={15} />
                          </button>

                          {org.status === "pending" && (
                            <>
                              <button
                                onClick={() => handleApprove(org)}
                                disabled={actionLoading === org.id}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 shadow-sm shadow-emerald-500/20"
                              >
                                {actionLoading === org.id ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                Approve
                              </button>
                              <button
                                onClick={() => handleReject(org)}
                                disabled={actionLoading === org.id}
                                className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5"
                              >
                                <XCircle size={12} /> Reject
                              </button>
                            </>
                          )}

                          {org.status === "approved" && (
                            <>
                              <button
                                onClick={() => handleWhitelistOnly(org)}
                                disabled={actionLoading === org.id}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 shadow-lg shadow-indigo-500/10"
                              >
                                {actionLoading === org.id ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                Sync Whitelist
                              </button>
                              <button
                                onClick={() => handleRevoke(org)}
                                disabled={actionLoading === org.id}
                                className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5"
                              >
                                {actionLoading === org.id ? <RefreshCw size={12} className="animate-spin" /> : <UserMinus size={12} />}
                                Revoke
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Expanded detail */}
                      <AnimatePresence>
                        {selectedOrg?.id === org.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-4 pt-4 border-t border-slate-200"
                          >
                            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200">
                              <span className="text-slate-500 font-bold block mb-1 uppercase text-[10px] tracking-widest">About their events:</span>
                              {org.description || "No description provided."}
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono mt-2">
                              Submitted: {org.submittedAt?.toDate?.()?.toLocaleString() || "—"}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── Side Panel ── */}
          <div className="lg:col-span-4 space-y-6">

            {/* Revenue board */}
            <section className="bg-white border border-slate-200 p-7 rounded-3xl shadow-sm relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 text-slate-200 opacity-40 group-hover:rotate-12 transition-transform duration-500">
                <BarChart3 size={120} />
              </div>
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Contract Balance</h4>
              <div className="text-5xl font-black text-slate-900 tracking-tighter mt-2 mb-1">
                {parseFloat(platformBalance).toFixed(4)}
                <span className="text-xl text-indigo-600 ml-2">ETH</span>
              </div>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Sepolia Testnet</p>
            </section>

            {/* Circuit breaker */}
            <section className={`p-7 rounded-3xl border-2 shadow-sm transition-all duration-500 ${isPaused ? "bg-red-50 border-red-300" : "bg-white border-slate-200"}`}>
              <div className="flex justify-between items-start mb-5">
                <div>
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">Circuit Breaker</h4>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-widest">Emergency Protocol Freeze</p>
                </div>
                <div className={`${isPaused ? "text-red-500" : "text-slate-300"}`}><Lock size={22} /></div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-5">
                Halts all minting, transfers, and resale across the protocol instantly.
              </p>
              <div className="flex items-center justify-between gap-4">
                <span className={`text-xs font-black uppercase ${isPaused ? "text-red-600" : "text-emerald-600"}`}>
                  {isPaused ? "● FROZEN" : "● RUNNING"}
                </span>
                <button
                  onClick={handleTogglePause}
                  disabled={loading}
                  className={`w-20 h-10 rounded-full p-1 transition-all relative ${isPaused ? "bg-red-500" : "bg-slate-300"}`}
                >
                  <motion.div
                    animate={{ x: isPaused ? 40 : 0 }}
                    className="w-8 h-8 bg-white rounded-full shadow-md flex items-center justify-center text-slate-900"
                  >
                    {loading ? <RefreshCw size={13} className="animate-spin" /> : (isPaused ? <Unlock size={13} /> : <Lock size={13} />)}
                  </motion.div>
                </button>
              </div>
            </section>

            {/* Deployer Funding Card */}
            <section className="bg-white border border-slate-200 p-7 rounded-3xl shadow-sm relative">
              <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">Deployer Gas Manager</h4>
              <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-widest">Fund Sepolia Contract Deployer</p>
              <p className="text-xs text-slate-600 leading-relaxed mt-3 mb-4">
                The smart contract deployer wallet needs gas to deploy contract updates or run whitelisting sync scripts on Sepolia. Fund the deployer wallet <span className="font-mono text-indigo-600 font-bold break-all">0x081c0e3CD35eE02a69F6423439A2BEB1F6C22BFF</span> with 0.005 Sepolia ETH.
              </p>
              <button
                onClick={async () => {
                  if (!wallet) { push("error", "Please connect your admin wallet first."); return; }
                  try {
                    const eip1193Provider = await wallet.getEthereumProvider();
                    const provider = new ethers.BrowserProvider(eip1193Provider);
                    const signer = await provider.getSigner();
                    const tx = await signer.sendTransaction({
                      to: "0x081c0e3CD35eE02a69F6423439A2BEB1F6C22BFF",
                      value: ethers.parseEther("0.005")
                    });
                    push("info", `Transaction sent: ${tx.hash.substring(0, 18)}…`);
                    await tx.wait();
                    push("success", "Deployer wallet funded successfully.");
                  } catch (e) {
                    push("error", e.message || "Failed to fund deployer.");
                  }
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20"
              >
                Send 0.005 ETH to Deployer
              </button>
            </section>

            {/* Quick tip */}
            <div className="p-5 bg-indigo-50 border border-indigo-200 rounded-2xl">
              <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest mb-2">How Approval Works</p>
              <ol className="space-y-1.5 text-xs text-slate-600">
                <li className="flex gap-2"><span className="text-indigo-600 font-bold">1.</span> Organiser submits registration form</li>
                <li className="flex gap-2"><span className="text-indigo-600 font-bold">2.</span> Application appears here under "Pending"</li>
                <li className="flex gap-2"><span className="text-indigo-600 font-bold">3.</span> Click Approve → whitelists them on-chain</li>
                <li className="flex gap-2"><span className="text-indigo-600 font-bold">4.</span> Organiser can now mint tickets</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <ToastStack toasts={toasts} dismiss={dismiss} />
    </div>
  );
};

// ─── Mini stat card ───────────────────────────────────────────────────────────
const MiniStat = ({ label, value, color, icon, suffix }) => {
  const colors = {
    amber: "bg-amber-50 border-amber-200 text-amber-600",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-600",
    red: "bg-red-50 border-red-200 text-red-600",
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-600",
  };
  return (
    <div className={`p-4 sm:p-5 rounded-2xl border shadow-sm ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-[10px] font-black uppercase tracking-widest">{label}</span></div>
      <div className="text-2xl sm:text-3xl font-black text-slate-900">{value}<span className="text-sm ml-1 opacity-60">{suffix}</span></div>
    </div>
  );
};

// ─── Loading skeletons ────────────────────────────────────────────────────────
const StatSkeleton = () => (
  <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 bg-white shadow-sm animate-pulse">
    <div className="h-3 w-20 bg-slate-200 rounded mb-3" />
    <div className="h-7 w-12 bg-slate-200 rounded" />
  </div>
);

const RowSkeleton = () => (
  <div className="p-4 sm:p-6 animate-pulse">
    <div className="flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-slate-200 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-40 bg-slate-200 rounded" />
        <div className="h-3 w-64 bg-slate-200/70 rounded" />
        <div className="h-2.5 w-52 bg-slate-200/50 rounded" />
      </div>
    </div>
  </div>
);

export default SystemAdminConsole;
