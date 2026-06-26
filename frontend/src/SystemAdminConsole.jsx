import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import {
  ShieldAlert, UserPlus, UserMinus, Activity,
  BarChart3, Lock, Unlock, RefreshCw, CheckCircle2,
  XCircle, Clock, Building2, Mail, Tag, User, Eye
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { CONTRACT_ADDRESS, CONTRACT_ABI, getContractAddress } from "./constants";
import { db } from "./firebase";
import {
  collection, getDocs, doc, updateDoc, serverTimestamp, query, orderBy
} from "firebase/firestore";

const SystemAdminConsole = ({ walletAddress, wallet, connectWallet }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [organisers, setOrganisers] = useState([]);
  const [platformBalance, setPlatformBalance] = useState("0.0");
  const [activeTab, setActiveTab] = useState("pending");
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // orgId being processed

  // ── Fetch Firestore organisers ──
  const fetchOrganisers = async () => {
    try {
      const q = query(collection(db, "organisers"), orderBy("submittedAt", "desc"));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setOrganisers(list);
    } catch (err) {
      console.error("Firestore fetch failed:", err);
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

  // Depend on the stable address string, not the `wallet` object (its identity
  // changes every render, which caused an infinite fetch/abort loop).
  useEffect(() => {
    fetchOrganisers();
    fetchChainData();
  }, [walletAddress]);

  // ── Approve: Firestore + on-chain whitelist ──
  const handleApprove = async (org) => {
    setActionLoading(org.id);
    try {
      if (!wallet) {
        alert("Please connect your admin wallet first!");
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
      alert(`✅ ${org.organizationName} approved and whitelisted on-chain successfully!`);
    } catch (err) {
      console.error("Approval failed:", err);
      alert(`Approval failed: ${err.reason || err.message || "Unknown error"}`);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Sync Whitelist (Force whitelist de-synced approved organizers on-chain) ──
  const handleWhitelistOnly = async (org) => {
    setActionLoading(org.id);
    try {
      if (!wallet) {
        alert("Please connect your admin wallet first!");
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
      alert(`✅ ${org.organizationName} whitelisted on-chain successfully!`);
    } catch (err) {
      console.error("Whitelisting failed:", err);
      alert(`Whitelisting failed: ${err.reason || err.message || "Unknown error"}`);
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
    } catch (err) {
      console.error("Rejection failed:", err);
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
        alert("Please connect your admin wallet first!");
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
    } catch (err) {
      console.error("Revoke failed:", err);
      alert(`Revoke failed: ${err.reason || err.message || "Unknown error"}`);
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
    } catch (err) {
      console.error("Circuit breaker failed:", err);
      alert(err.reason || "Unauthorized: Only Owner can toggle.");
    } finally {
      setLoading(false);
    }
  };

  const pending = organisers.filter(o => o.status === "pending");
  const approved = organisers.filter(o => o.status === "approved");
  const rejected = organisers.filter(o => o.status === "rejected");

  const tabData = { pending, approved, rejected };
  const currentList = tabData[activeTab] || [];

  const statusColor = {
    pending: "amber",
    approved: "emerald",
    rejected: "red",
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-200 p-6 sm:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-red-600 rounded-2xl flex items-center justify-center shadow-xl shadow-red-500/20 rotate-3">
              <ShieldAlert className="text-white w-8 h-8" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-white tracking-tighter uppercase">Admin Console</h1>
              <p className="text-xs text-slate-500 font-mono flex items-center gap-2">
                <Activity size={12} className="text-emerald-500 animate-pulse" />
                Protocol Runtime: {isPaused ? "FROZEN" : "Healthy"} · {walletAddress?.substring(0, 14)}...
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!walletAddress && (
              <button onClick={connectWallet} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg transition-all">
                Connect Wallet
              </button>
            )}
            <div className={`px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest ${isPaused ? "bg-red-500/10 border-red-500/50 text-red-500" : "bg-emerald-500/10 border-emerald-500/50 text-emerald-500"}`}>
              {isPaused ? "⚠ Frozen" : "● Operational"}
            </div>
          </div>
        </header>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MiniStat label="Pending Review" value={pending.length} color="amber" icon={<Clock size={18} />} />
          <MiniStat label="Approved" value={approved.length} color="emerald" icon={<CheckCircle2 size={18} />} />
          <MiniStat label="Rejected" value={rejected.length} color="red" icon={<XCircle size={18} />} />
          <MiniStat label="Contract ETH" value={`${parseFloat(platformBalance).toFixed(3)}`} color="indigo" icon={<BarChart3 size={18} />} suffix="ETH" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* ── Organiser Applications Panel ── */}
          <div className="lg:col-span-8 space-y-5">

            {/* Pending alert banner */}
            {pending.length > 0 && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-amber-950/30 border border-amber-500/40 rounded-2xl flex items-center gap-3">
                <Clock size={18} className="text-amber-400 animate-pulse shrink-0" />
                <p className="text-amber-300 text-sm font-bold">
                  {pending.length} application{pending.length > 1 ? "s" : ""} awaiting your review
                </p>
              </motion.div>
            )}

            {/* Tabs */}
            <div className="bg-[#1e2538] border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
              <div className="flex border-b border-slate-800">
                {["pending", "approved", "rejected"].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-4 text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activeTab === tab
                      ? tab === "pending" ? "bg-amber-500/10 text-amber-400 border-b-2 border-amber-500"
                        : tab === "approved" ? "bg-emerald-500/10 text-emerald-400 border-b-2 border-emerald-500"
                          : "bg-red-500/10 text-red-400 border-b-2 border-red-500"
                      : "text-slate-500 hover:text-white"}`}
                  >
                    {tab === "pending" && <Clock size={14} />}
                    {tab === "approved" && <CheckCircle2 size={14} />}
                    {tab === "rejected" && <XCircle size={14} />}
                    {tab} ({tabData[tab].length})
                  </button>
                ))}
              </div>

              {/* List */}
              <div className="divide-y divide-slate-800/50">
                {currentList.length === 0 ? (
                  <div className="p-16 text-center text-slate-600">
                    <Building2 size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-bold">No {activeTab} applications</p>
                  </div>
                ) : (
                  currentList.map(org => (
                    <motion.div
                      key={org.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-6 hover:bg-slate-800/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4 min-w-0">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${activeTab === "pending" ? "bg-amber-500/10 text-amber-400" : activeTab === "approved" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                            <Building2 size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-white font-bold text-sm">{org.organizationName}</h4>
                              <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${activeTab === "pending" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : activeTab === "approved" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                                {org.status}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                              <span className="text-xs text-slate-400 flex items-center gap-1"><User size={11} className="text-slate-500" />{org.legalName}</span>
                              <span className="text-xs text-slate-400 flex items-center gap-1"><Mail size={11} className="text-slate-500" />{org.email}</span>
                              <span className="text-xs text-slate-400 flex items-center gap-1"><Tag size={11} className="text-slate-500" />{org.eventType}</span>
                            </div>
                            <p className="text-[10px] font-mono text-slate-600 mt-1">{org.walletAddress}</p>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => setSelectedOrg(selectedOrg?.id === org.id ? null : org)}
                            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl transition-all"
                            title="View details"
                          >
                            <Eye size={15} />
                          </button>

                          {org.status === "pending" && (
                            <>
                              <button
                                onClick={() => handleApprove(org)}
                                disabled={actionLoading === org.id}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
                              >
                                {actionLoading === org.id ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                Approve
                              </button>
                              <button
                                onClick={() => handleReject(org)}
                                disabled={actionLoading === org.id}
                                className="px-4 py-2 bg-red-950/40 hover:bg-red-500/20 text-red-400 border border-red-900/40 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5"
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
                                className="px-4 py-2 bg-red-950/40 hover:bg-red-500/20 text-red-400 border border-red-900/40 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5"
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
                            className="mt-4 pt-4 border-t border-slate-800/50"
                          >
                            <p className="text-xs text-slate-400 leading-relaxed bg-[#0b0f19]/50 p-4 rounded-xl border border-slate-800">
                              <span className="text-slate-500 font-bold block mb-1 uppercase text-[10px] tracking-widest">About their events:</span>
                              {org.description || "No description provided."}
                            </p>
                            <p className="text-[10px] text-slate-600 font-mono mt-2">
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
            <section className="bg-[#1e2538] border border-slate-800 p-7 rounded-3xl shadow-2xl relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 opacity-5 group-hover:rotate-12 transition-transform duration-500">
                <BarChart3 size={120} />
              </div>
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Contract Balance</h4>
              <div className="text-5xl font-black text-white tracking-tighter mt-2 mb-1">
                {parseFloat(platformBalance).toFixed(4)}
                <span className="text-xl text-indigo-500 ml-2">ETH</span>
              </div>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Sepolia Testnet</p>
            </section>

            {/* Circuit breaker */}
            <section className={`p-7 rounded-3xl border-2 shadow-2xl transition-all duration-500 ${isPaused ? "bg-red-950/20 border-red-500/50" : "bg-slate-900/40 border-slate-800"}`}>
              <div className="flex justify-between items-start mb-5">
                <div>
                  <h4 className="text-sm font-black text-white uppercase tracking-tight">Circuit Breaker</h4>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-widest">Emergency Protocol Freeze</p>
                </div>
                <div className={`${isPaused ? "text-red-500" : "text-slate-700"}`}><Lock size={22} /></div>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed mb-5">
                Halts all minting, transfers, and resale across the protocol instantly.
              </p>
              <div className="flex items-center justify-between gap-4">
                <span className={`text-xs font-black uppercase ${isPaused ? "text-red-400" : "text-emerald-400"}`}>
                  {isPaused ? "● FROZEN" : "● RUNNING"}
                </span>
                <button
                  onClick={handleTogglePause}
                  disabled={loading}
                  className={`w-20 h-10 rounded-full p-1 transition-all relative ${isPaused ? "bg-red-500" : "bg-slate-700"}`}
                >
                  <motion.div
                    animate={{ x: isPaused ? 40 : 0 }}
                    className="w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-900"
                  >
                    {loading ? <RefreshCw size={13} className="animate-spin" /> : (isPaused ? <Unlock size={13} /> : <Lock size={13} />)}
                  </motion.div>
                </button>
              </div>
            </section>

            {/* Deployer Funding Card */}
            <section className="bg-slate-900/40 border border-slate-800 p-7 rounded-3xl shadow-2xl relative">
              <h4 className="text-sm font-black text-white uppercase tracking-tight">Deployer Gas Manager</h4>
              <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-widest">Fund Sepolia Contract Deployer</p>
              <p className="text-xs text-slate-400 leading-relaxed mt-3 mb-4">
                The smart contract deployer wallet needs gas to deploy contract updates or run whitelisting sync scripts on Sepolia. Fund the deployer wallet <span className="font-mono text-indigo-400 font-bold">0x081c0e3CD35eE02a69F6423439A2BEB1F6C22BFF</span> with 0.005 Sepolia ETH.
              </p>
              <button
                onClick={async () => {
                  if (!wallet) return;
                  try {
                    const eip1193Provider = await wallet.getEthereumProvider();
                    const provider = new ethers.BrowserProvider(eip1193Provider);
                    const signer = await provider.getSigner();
                    const tx = await signer.sendTransaction({
                      to: "0x081c0e3CD35eE02a69F6423439A2BEB1F6C22BFF",
                      value: ethers.parseEther("0.005")
                    });
                    alert(`Transaction sent successfully! Hash: ${tx.hash}`);
                    await tx.wait();
                    alert("Deployer wallet funded successfully! The AI assistant can now deploy the contract updates.");
                  } catch (e) {
                    alert(e.message || "Failed to fund deployer");
                  }
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20"
              >
                Send 0.005 ETH to Deployer
              </button>
            </section>

            {/* Quick tip */}
            <div className="p-5 bg-indigo-950/20 border border-indigo-500/20 rounded-2xl">
              <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest mb-2">How Approval Works</p>
              <ol className="space-y-1.5 text-xs text-slate-400">
                <li className="flex gap-2"><span className="text-indigo-500 font-bold">1.</span> Organiser submits registration form</li>
                <li className="flex gap-2"><span className="text-indigo-500 font-bold">2.</span> Application appears here under "Pending"</li>
                <li className="flex gap-2"><span className="text-indigo-500 font-bold">3.</span> Click Approve → whitelists them on-chain</li>
                <li className="flex gap-2"><span className="text-indigo-500 font-bold">4.</span> Organiser can now mint tickets</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Mini stat card ───────────────────────────────────────────────────────────
const MiniStat = ({ label, value, color, icon, suffix }) => {
  const colors = {
    amber: "bg-amber-500/10 border-amber-500/20 text-amber-400",
    emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    red: "bg-red-500/10 border-red-500/20 text-red-400",
    indigo: "bg-indigo-500/10 border-indigo-500/20 text-indigo-400",
  };
  return (
    <div className={`p-5 rounded-2xl border ${colors[color]} bg-opacity-10`}>
      <div className="flex items-center gap-2 mb-2 opacity-70">{icon}<span className="text-[10px] font-black uppercase tracking-widest">{label}</span></div>
      <div className="text-3xl font-black text-white">{value}<span className="text-sm ml-1 opacity-60">{suffix}</span></div>
    </div>
  );
};

export default SystemAdminConsole;
