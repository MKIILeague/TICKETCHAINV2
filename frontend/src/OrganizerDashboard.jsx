import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { ethers } from "ethers";
import {
  Landmark, ShieldAlert, Ticket as TicketIcon,
  Trash2, DollarSign, RefreshCw,
  Clock, XCircle, FileText, Building2, Mail, User, Tag, Search, Info, LogOut, Home,
  Wallet, Send, QrCode, Copy, Check, ExternalLink, LayoutDashboard, Users, UserPlus, ShieldCheck, X,
  CalendarPlus, Plus, TrendingUp, BarChart3
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { CONTRACT_ABI, PUBLIC_RPC_URL, getContractAddress, getDeployments } from "./constants";
import { db } from "./firebase";
import { doc, setDoc, getDoc, deleteDoc, collection, query, where, getDocs, onSnapshot } from "firebase/firestore";
import { usePrivy } from "@privy-io/react-auth";
import { fetchOrgStatus, getCachedOrgStatus, setOrgStatusCache } from "./orgStatus";
import { EVENT_STATUS, effectiveStatus } from "./eventStatus";
import { ipfsToHttp } from "./ipfs";
import { rm, ethLabel } from "./currency";
import EventWizard from "./EventWizard";

// ─── Registration Form ────────────────────────────────────────────────────────
const RegistrationForm = ({ walletAddress, onSubmitted }) => {
  const { user } = usePrivy();
  const [form, setForm] = useState({
    // Prefill from the Privy login email — editable, most organisers use the same one.
    legalName: "", organizationName: "", email: user?.email?.address || "", eventType: "", description: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const eventTypes = ["Concerts & Music", "Sports & Athletics", "Conferences & Tech", "Arts & Theatre", "Festivals", "Other"];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.legalName || !form.organizationName || !form.email || !form.eventType) {
      setError("Please fill in all required fields.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Use a 8-second timeout so the form never hangs forever
      const writePromise = setDoc(doc(db, "organisers", walletAddress), {
        walletAddress,
        legalName: form.legalName,
        organizationName: form.organizationName,
        email: form.email,
        eventType: form.eventType,
        description: form.description,
        status: "pending",
        submittedAt: new Date().toISOString(), // client-side date — no server round-trip
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 8000)
      );
      await Promise.race([writePromise, timeoutPromise]);
      onSubmitted();
    } catch (err) {
      console.error("Registration failed:", err);
      if (err.message === "timeout") {
        setError("Request timed out. Check your internet connection and try again.");
      } else if (err.code === "permission-denied") {
        setError("We couldn't save your application right now. Please try again later or contact support.");
      } else {
        setError(`Submission failed: ${err.message || "Unknown error"}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 bg-indigo-600 rounded-2xl items-center justify-center mb-4">
            <Building2 size={28} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">Register as an organizer</h1>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            Submit your details to apply. An admin reviews and approves your account before you can issue tickets.
          </p>
        </div>

        <div className="mb-5 p-4 bg-white border border-slate-200 rounded-xl flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Linked wallet</p>
            <p className="text-sm font-mono text-slate-700 truncate">{walletAddress}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl p-7 space-y-5 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <FormField icon={<User size={15} />} label="Legal full name *">
              <input type="text" value={form.legalName}
                onChange={e => setForm({ ...form, legalName: e.target.value })}
                placeholder="e.g. Syeda Rahman"
                className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all" />
            </FormField>
            <FormField icon={<Building2 size={15} />} label="Organisation name *">
              <input type="text" value={form.organizationName}
                onChange={e => setForm({ ...form, organizationName: e.target.value })}
                placeholder="e.g. SoundWave Events Ltd."
                className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all" />
            </FormField>
          </div>

          <FormField icon={<Mail size={15} />} label="Contact email *">
            <input type="email" value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="e.g. contact@soundwave.io"
              className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all" />
          </FormField>

          <FormField icon={<Tag size={15} />} label="Primary event type *">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {eventTypes.map(type => (
                <button key={type} type="button"
                  onClick={() => setForm({ ...form, eventType: type })}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all ${form.eventType === type
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-slate-900"}`}>
                  {type}
                </button>
              ))}
            </div>
          </FormField>

          <FormField icon={<FileText size={15} />} label="Tell us about your events">
            <textarea rows={3} value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Brief description of the events you plan to organise..."
              className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all resize-none" />
          </FormField>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2">
            {loading ? <><RefreshCw size={16} className="animate-spin" /> Submitting…</> : "Submit application"}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const FormField = ({ icon, label, children }) => (
  <div className="space-y-2">
    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
      <span className="text-indigo-600">{icon}</span>{label}
    </label>
    {children}
  </div>
);

// ─── Pending / Rejected status screens ─────────────────────────────────────────
const StatusScreen = ({ tone, icon, title, children, details }) => {
  const ring = tone === "amber" ? "bg-amber-50 border-amber-200 text-amber-600"
    : tone === "red" ? "bg-red-50 border-red-200 text-red-600"
    : "bg-emerald-50 border-emerald-200 text-emerald-600";
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="text-center max-w-md w-full">
        <div className={`inline-flex w-20 h-20 rounded-full border-2 items-center justify-center mb-6 ${ring}`}>
          {icon}
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 mb-3">{title}</h2>
        <p className="text-slate-500 text-sm mb-6 leading-relaxed">{children}</p>
        {details && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 text-left space-y-2.5 shadow-sm">{details}</div>
        )}
      </motion.div>
    </div>
  );
};

const DetailRow = ({ label, value, valueClass = "text-slate-900" }) => (
  <div className="flex justify-between text-sm">
    <span className="text-slate-500">{label}</span>
    <span className={`font-semibold ${valueClass}`}>{value}</span>
  </div>
);

const PendingScreen = ({ orgData, walletAddress }) => (
  <StatusScreen tone="amber" icon={<Clock size={40} className="animate-pulse" />} title="Application pending"
    details={
      <>
        <DetailRow label="Name" value={orgData?.legalName} />
        <DetailRow label="Organisation" value={orgData?.organizationName} />
        <DetailRow label="Event type" value={orgData?.eventType} valueClass="text-amber-600" />
        <DetailRow label="Status" value="Pending review" valueClass="text-amber-600" />
        {walletAddress && (
          <DetailRow label="Wallet" value={`${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`} valueClass="text-slate-700 font-mono" />
        )}
      </>
    }>
    Your organiser application for <span className="text-slate-900 font-semibold">{orgData?.organizationName}</span> is
    under review. This page updates automatically the moment an admin approves you — no need to refresh.
  </StatusScreen>
);

const RejectedScreen = ({ orgData }) => (
  <StatusScreen tone="red" icon={<XCircle size={40} />} title="Application rejected"
    details={<DetailRow label="Status" value="Rejected" valueClass="text-red-600" />}>
    Unfortunately, your application for <span className="text-slate-900 font-semibold">{orgData?.organizationName}</span> was
    not approved. Please contact support for more information.
  </StatusScreen>
);

// ─── Main Organiser Dashboard ─────────────────────────────────────────────────
const OrganizerDashboard = ({ walletAddress, wallet, connectWallet, logout, mode = "dashboard", authenticated = false, ready = true }) => {
  const navigate = useNavigate();
  // Seed from the shared cache so navigating in from the navbar renders the
  // dashboard immediately instead of flashing "loading" and bouncing to login.
  const [orgStatus, setOrgStatus] = useState(() => getCachedOrgStatus(walletAddress)?.status ?? "loading"); // loading, unregistered, pending, rejected, approved
  const [orgData, setOrgData] = useState(() => getCachedOrgStatus(walletAddress)?.data ?? null);

  // Sidebar section
  const [section, setSection] = useState("overview"); // overview | wallet | staff

  // Existing dashboard states
  const [isPaused, setIsPaused] = useState(false);
  const [totalRevenue, setTotalRevenue] = useState("0.0");
  const [deployedStock, setDeployedStock] = useState(0);
  const [voidedCount, setVoidedCount] = useState(0);
  const [tickets, setTickets] = useState([]);
  // Sales timeline — one point per on-chain TicketPurchased for this organizer's
  // tickets: { id, price (ETH), t (unix seconds) }. Powers the overview graph.
  const [salesSeries, setSalesSeries] = useState([]);
  // Off-chain event docs (the Firestore `sold` counter buyers see at checkout /
  // on the storefront). Merged into the on-chain stats so every view agrees.
  const [eventDocs, setEventDocs] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  // Overview event list filter: live | past | canceled | all. Defaults to live —
  // "Active events" should mean events actually on sale, not the full history.
  const [eventFilter, setEventFilter] = useState("live");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [voidingTickets, setVoidingTickets] = useState({});
  const [activeChainId, setActiveChainId] = useState(11155111);
  const [localhostFaucetLoading, setLocalhostFaucetLoading] = useState(false);
  // Firestore "approved" is only the UI signal — the contract whitelist is the
  // real mint gate. null = unknown (read unavailable), true/false = on-chain truth.
  const [onChainWhitelisted, setOnChainWhitelisted] = useState(null);

  // Wallet states
  const [ethBalance, setEthBalance] = useState("0.00");
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [isSendingEth, setIsSendingEth] = useState(false);

  // Staff states
  const [staffList, setStaffList] = useState([]);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffLoading, setStaffLoading] = useState(false);
  const [addStaffLoading, setAddStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState("");

  const networkLabel = activeChainId === 31337 ? "Localhost" : "Sepolia testnet";

  const handleLocalhostFaucet = async () => {
    if (!walletAddress) return;
    try {
      setLocalhostFaucetLoading(true);
      const localProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const localSigner = new ethers.Wallet(
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        localProvider
      );

      const tx = await localSigner.sendTransaction({
        to: walletAddress,
        value: ethers.parseEther("10.0")
      });

      await tx.wait();
      alert("✅ Received 10.0 Localhost ETH! Your wallet is now funded.");
      fetchDashboardData();
    } catch (err) {
      console.error("Localhost faucet failed:", err);
      alert("❌ Faucet failed. Ensure your local Hardhat node is running on http://127.0.0.1:8545.");
    } finally {
      setLocalhostFaucetLoading(false);
    }
  };

  // Leave the guarded route FIRST (replace, so Back can't return to the dead
  // dashboard entry), THEN clear the Privy session — otherwise the RequireRole
  // "Please sign in" card flashes on the bare full-screen route with no way out.
  const handleLogout = async () => {
    navigate("/", { replace: true });
    try { await logout?.(); } catch (err) { console.warn("Logout failed:", err?.message); }
  };

  const handleCopyAddress = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onSendEth = async () => {
    if (!wallet || !sendRecipient || !sendAmount) return;
    setIsSendingEth(true);
    try {
      const eip1193Provider = await wallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(eip1193Provider);
      const signer = await provider.getSigner();
      const tx = await signer.sendTransaction({
        to: sendRecipient,
        value: ethers.parseEther(sendAmount.toString())
      });
      await tx.wait();
      alert("✅ ETH sent successfully!");
      setShowSendModal(false);
      setSendRecipient("");
      setSendAmount("");
      fetchDashboardData();
    } catch (error) {
      console.error("Send ETH failed:", error);
      alert(error.reason || error.message || "Transaction failed");
    } finally {
      setIsSendingEth(false);
    }
  };

  // ── Check Firestore for organiser record (shared cache + revalidate) ──
  const checkOrgStatus = async () => {
    if (!walletAddress) return;
    // Show the cached status (if any) while we revalidate, so we never flash a
    // spinner or bounce an already-approved organizer to the login screen.
    const cached = getCachedOrgStatus(walletAddress);
    if (cached) { setOrgStatus(cached.status); setOrgData(cached.data); }
    else setOrgStatus("loading");
    try {
      const { status, data } = await fetchOrgStatus(walletAddress);
      setOrgData(data);
      setOrgStatus(status); // "unregistered" | "pending" | "approved" | "rejected"
    } catch (err) {
      console.error("Firestore check failed:", err);
      // Don't fall through to the registration form on a transient read
      // failure — show a retryable error instead so an approved organizer
      // isn't told to re-register. If we already have a cached status, keep it.
      if (!cached) setOrgStatus("error");
    }
  };

  useEffect(() => {
    checkOrgStatus();
  }, [walletAddress]);

  // While the application is pending, listen to the organiser doc live so an
  // admin approval flips this screen into the dashboard without a manual reload.
  useEffect(() => {
    if (!walletAddress || orgStatus !== "pending") return;
    const unsub = onSnapshot(
      doc(db, "organisers", walletAddress),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const status = data.status || "pending";
        setOrgStatusCache(walletAddress, status, data);
        setOrgData(data);
        setOrgStatus(status);
      },
      (err) => console.warn("Org status listener failed:", err?.message)
    );
    return unsub;
  }, [walletAddress, orgStatus]);

  const fetchDashboardData = async () => {
    if (!walletAddress) return;

    // A) Off-chain events + sold counters FIRST and independently. This powers
    //    "Active events", "Tickets sold" and the sales pool, so it must NEVER be
    //    blocked by a flaky on-chain RPC read below (the old order gated it
    //    behind the log queries — one failure left the overview empty).
    try {
      const evSnap = await getDocs(query(collection(db, "events"), where("organiserId", "==", walletAddress)));
      setEventDocs(evSnap.docs.map((d) => d.data()));
    } catch (evErr) {
      console.warn("Event docs load failed:", evErr?.message);
    }

    if (!wallet) return;

    // B) On-chain reads — wrapped so any failure here can't wipe the data above.
    try {
      const walletProvider = new ethers.BrowserProvider(await wallet.getEthereumProvider());
      const walletChain = Number((await walletProvider.getNetwork()).chainId);
      // Sepolia-only in production; local Hardhat honoured only in dev. Also
      // stops a stray localhost wallet from showing a bogus ~10000-ETH balance.
      const walletMatches = walletChain === 11155111 || (import.meta.env.DEV && walletChain === 31337);
      const currentChainId = walletMatches ? walletChain : 11155111;
      setActiveChainId(currentChainId);

      // Ordered read providers: the wallet's own RPC first (when it's on our
      // chain, it has generous eth_getLogs limits), then a public fallback — so a
      // single flaky endpoint can never strand the balance/data at 0.
      const readProviders = [];
      if (walletMatches) readProviders.push(walletProvider);
      readProviders.push(new ethers.JsonRpcProvider(currentChainId === 31337 ? "http://127.0.0.1:8545" : PUBLIC_RPC_URL));
      const provider = readProviders[0];

      // Personal wallet balance for "My Wallet" — try each provider so it can
      // never strand at 0 just because one endpoint hiccupped.
      setIsFetchingBalance(true);
      let gotBalance = false;
      for (const p of readProviders) {
        try {
          setEthBalance(ethers.formatEther(await p.getBalance(walletAddress)));
          gotBalance = true;
          break;
        } catch (balErr) {
          console.warn("Organizer balance read failed on a provider:", balErr?.message);
        }
      }
      if (!gotBalance) console.error("All providers failed to return organizer balance.");
      setIsFetchingBalance(false);

      const deployments = getDeployments(currentChainId);
      const primaryContract = new ethers.Contract(deployments[0].address, CONTRACT_ABI, provider);
      setIsPaused(await primaryContract.paused().catch(() => false));

      // Surface a missing on-chain whitelist NOW (banner) instead of letting the
      // organizer discover it as a cryptic revert at mint time. Admin approval is
      // two-part: Firestore status + whitelistOrganizer tx — the tx can fail.
      try {
        setOnChainWhitelisted(await primaryContract.whitelistedOrganizers(walletAddress));
      } catch { setOnChainWhitelisted(null); /* read failed — don't show a false alarm */ }

      // Withdrawable on-chain vault (credited only in a real-payment build;
      // stays 0 in the zero-value demo). Separate from the "sales pool" stat,
      // which is derived from actual sold counts below.
      try {
        setTotalRevenue(ethers.formatEther(await primaryContract.organizerBalances(walletAddress)));
      } catch { /* leave prior value */ }

      // Scan EVERY deployment for this organizer's mints AND the resulting
      // purchases, so events/tickets/sales minted on an older contract still
      // count. TicketPurchased isn't indexed by organizer, so per contract we
      // keep only purchases of tokens we minted there.
      let allTickets = [];
      let allSales = [];
      for (const dep of deployments) {
        try {
          const c = new ethers.Contract(dep.address, CONTRACT_ABI, provider);
          const mintLogs = await c.queryFilter(c.filters.TicketMinted(null, walletAddress), dep.startBlock);
          const rows = (await Promise.all(mintLogs.map(async (log) => {
            try {
              const id = log.args[0];
              const details = await c.getTicketDetails(id);
              const owner = await c.ownerOf(id);
              return {
                id: id.toString(),
                contractAddress: dep.address,
                eventTitle: details.eventName || `Ticket #${id}`,
                mintPrice: ethers.formatEther(details.originalPrice || 0n),
                isUsed: details.isUsed || false,
                isListed: details.isForResale || false,
                owner,
                category: "VIP",
              };
            } catch { return null; }
          }))).filter(Boolean);
          allTickets = allTickets.concat(rows);

          const idList = rows.map((r) => r.id);
          const myIds = new Set(idList);
          const titleById = {};
          rows.forEach((r) => { titleById[r.id] = (r.eventTitle || "").split(" #")[0]; });
          // Filter by our token IDs on the INDEXED `ticketId` topic — an
          // unfiltered TicketPurchased query over the whole range is what public
          // RPCs reject/truncate (why the graph showed no sales despite a buy).
          const purchaseLogs = idList.length
            ? await c.queryFilter(c.filters.TicketPurchased(idList), dep.startBlock)
            : [];
          const mine = purchaseLogs.filter((l) => myIds.has(l.args[0].toString()));
          const times = {};
          await Promise.all([...new Set(mine.map((l) => l.blockNumber))].map(async (bn) => {
            try { const b = await provider.getBlock(bn); times[bn] = Number(b?.timestamp) || 0; } catch { /* skip */ }
          }));
          mine.forEach((l) => allSales.push({
            id: l.args[0].toString(),
            title: titleById[l.args[0].toString()] || `Ticket #${l.args[0]}`,
            price: parseFloat(ethers.formatEther(l.args[2] || 0n)),
            t: times[l.blockNumber] || 0,
          }));
        } catch (depErr) {
          console.warn(`Organizer scan of ${dep.address} failed:`, depErr?.message);
        }
      }

      setTickets(allTickets);
      setDeployedStock(allTickets.length);
      setVoidedCount(allTickets.filter((t) => t.isUsed).length);
      allSales.sort((a, b) => (a.t - b.t) || (Number(a.id) - Number(b.id)));
      setSalesSeries(allSales);
    } catch (error) {
      console.error("Dashboard on-chain sync error:", error);
    }
  };

  useEffect(() => {
    if (orgStatus === "approved" && walletAddress) {
      fetchDashboardData();
    }
  }, [orgStatus, walletAddress]);

  // ── Staff management (Firestore: staff/{email}) ──
  const loadStaff = async () => {
    if (!walletAddress) return;
    setStaffLoading(true);
    try {
      const q = query(collection(db, "staff"), where("organizerAddress", "==", walletAddress));
      const snap = await getDocs(q);
      setStaffList(snap.docs.map((d) => d.data()).sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1)));
    } catch (err) {
      console.error("Load staff failed:", err);
    } finally {
      setStaffLoading(false);
    }
  };

  useEffect(() => {
    if (orgStatus === "approved" && walletAddress) {
      loadStaff();
    }
  }, [orgStatus, walletAddress]);

  const addStaff = async (e) => {
    e?.preventDefault?.();
    const email = staffEmail.trim().toLowerCase();
    setStaffError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStaffError("Enter a valid email address.");
      return;
    }
    if (staffList.some((s) => s.email === email)) {
      setStaffError("That person is already on your staff list.");
      return;
    }
    setAddStaffLoading(true);
    try {
      // staff/{email} is keyed globally by email. Warn if it's already tied to a
      // different organizer so we don't silently steal their door staff.
      const existing = await getDoc(doc(db, "staff", email));
      if (existing.exists() && existing.data().organizerAddress !== walletAddress) {
        const proceed = window.confirm(
          `${email} is already assigned to another organizer (${existing.data().organizerName || "unknown"}).\n\nReassign them to you?`
        );
        if (!proceed) { setAddStaffLoading(false); return; }
      }
      await setDoc(doc(db, "staff", email), {
        email,
        organizerAddress: walletAddress,
        organizerName: orgData?.organizationName || "",
        addedAt: new Date().toISOString(),
      });
      setStaffEmail("");
      await loadStaff();
    } catch (err) {
      console.error("Add staff failed:", err);
      setStaffError(err.code === "permission-denied"
        ? "Permission denied — check Firestore is in Test Mode."
        : `Couldn't add staff: ${err.message || "unknown error"}`);
    } finally {
      setAddStaffLoading(false);
    }
  };

  const removeStaff = async (email) => {
    if (!window.confirm(`Remove ${email} from your staff? They'll lose access to the gate scanner.`)) return;
    try {
      await deleteDoc(doc(db, "staff", email));
      setStaffList((prev) => prev.filter((s) => s.email !== email));
    } catch (err) {
      console.error("Remove staff failed:", err);
      alert(err.reason || err.message || "Couldn't remove staff member.");
    }
  };

  const handleWithdraw = async () => {
    if (!wallet || withdrawLoading) return;
    try {
      setWithdrawLoading(true);
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

      const signer = await provider.getSigner();
      const contractAddress = getContractAddress(targetChainId);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

      // Pre-flight gas check
      const balance = await provider.getBalance(walletAddress);
      const balanceInEth = parseFloat(ethers.formatEther(balance));

      let estimatedCost = 0.0002; // Safe fallback
      try {
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
        const estimatedGas = await contract.withdrawOrganizerFunds.estimateGas();
        const totalGasLimit = (estimatedGas * 120n) / 100n;
        estimatedCost = parseFloat(ethers.formatEther(totalGasLimit * gasPrice));
      } catch (estErr) {
        console.warn("Dynamic estimation failed, using fallback:", estErr);
        const fallbackGas = 80000n; // Safe fallback gas
        const fallbackGasPrice = 3000000000n; // 3 Gwei
        estimatedCost = parseFloat(ethers.formatEther(fallbackGas * fallbackGasPrice));
      }

      if (balanceInEth < estimatedCost) {
        alert(`❌ Insufficient funds for gas!\n\nYou currently have ${balanceInEth.toFixed(4)} ETH, but you need at least ${estimatedCost.toFixed(4)} ETH to send this transaction.\n\nPlease fund your wallet before trying again.`);
        setWithdrawLoading(false);
        return;
      }

      const tx = await contract.withdrawOrganizerFunds();
      await tx.wait();
      alert("Funds withdrawn!");
      fetchDashboardData();
    } catch (error) {
      console.error("Withdrawal failed:", error);
      alert(error.reason || error.message || "Transaction failed");
    } finally {
      setWithdrawLoading(false);
    }
  };

  const handleVoidTicket = async (id) => {
    if (!wallet || voidingTickets[id]) return;
    try {
      setVoidingTickets(prev => ({ ...prev, [id]: true }));
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

      const signer = await provider.getSigner();
      const contractAddress = getContractAddress(targetChainId);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

      // Pre-flight gas check
      const balance = await provider.getBalance(walletAddress);
      const balanceInEth = parseFloat(ethers.formatEther(balance));

      let estimatedCost = 0.0002; // Safe fallback
      try {
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
        const estimatedGas = await contract.useTicket.estimateGas(id);
        const totalGasLimit = (estimatedGas * 120n) / 100n;
        estimatedCost = parseFloat(ethers.formatEther(totalGasLimit * gasPrice));
      } catch (estErr) {
        console.warn("Dynamic estimation failed, using fallback:", estErr);
        const fallbackGas = 80000n; // Safe fallback gas
        const fallbackGasPrice = 3000000000n; // 3 Gwei
        estimatedCost = parseFloat(ethers.formatEther(fallbackGas * fallbackGasPrice));
      }

      if (balanceInEth < estimatedCost) {
        alert(`❌ Insufficient funds for gas!\n\nYou currently have ${balanceInEth.toFixed(4)} ETH, but you need at least ${estimatedCost.toFixed(4)} ETH to send this transaction.\n\nPlease fund your wallet before trying again.`);
        setVoidingTickets(prev => ({ ...prev, [id]: false }));
        return;
      }

      const tx = await contract.useTicket(id);
      await tx.wait();
      alert(`Ticket #${id} voided!`);
      fetchDashboardData();
    } catch (error) {
      console.error("Voiding failed:", error);
      alert(error.reason || error.message || "Transaction failed");
    } finally {
      setVoidingTickets(prev => ({ ...prev, [id]: false }));
    }
  };

  // Group individual ticket tokens into events and compute sales statistics.
  // A ticket is "sold" once it leaves the organizer's wallet (bought by someone);
  // "available" = still held by the organizer & not redeemed; "redeemed" = used at gate.
  const me = (walletAddress || "").toLowerCase();
  // The on-chain `eventName` equals the Firestore `headline`, so the two sources
  // reconcile by title below.
  const eventStats = useMemo(() => {
    const groups = {};

    // 1) Seed from the organizer's published Firestore events — the same source
    //    of truth buyers see on the storefront. This is what keeps the overview
    //    populated even when the on-chain log query is empty (fresh redeploy,
    //    stale START_BLOCK on Sepolia, or a flaky RPC). Drafts/deleted are hidden.
    eventDocs.forEach((e) => {
      const title = (e.headline || "").trim();
      if (!title) return;
      const status = effectiveStatus(e);
      if (status === EVENT_STATUS.DRAFT || status === EVENT_STATUS.DELETED || !status) return;
      const total = Number(e.aggregateSupply) || 0;
      const sold = Number(e.sold) || 0;
      groups[title] = {
        title,
        price: e.priceEth || "0",
        total,
        sold,
        available: Math.max(0, total - sold),
        redeemed: 0,
        status,
        timestamp: e.timestamp || null,
        imageHash: e.imageHash || null,
      };
    });

    // 2) Overlay on-chain ticket data. `redeemed` is live gate state (never in
    //    Firestore), so it always comes from chain. Any on-chain event with no
    //    matching Firestore doc (legacy mint) still gets its own card.
    tickets.forEach((t) => {
      const title = (t.eventTitle || "Untitled").split(" #")[0];
      let g = groups[title];
      if (!g) {
        g = groups[title] = { title, price: t.mintPrice, total: 0, sold: 0, available: 0, redeemed: 0, status: EVENT_STATUS.PUBLISHED, timestamp: null, imageHash: null };
        g._onChainOnly = true;
      }
      if (t.isUsed) g.redeemed += 1;
      if (g._onChainOnly) {
        g.total += 1;
        if (t.owner && t.owner.toLowerCase() !== me) g.sold += 1;
        else if (!t.isUsed) g.available += 1;
      }
    });

    // Live first, then past, then canceled; biggest events first within a group
    // (matters for the "All" tab, and keeps any single-status list stable).
    const order = { [EVENT_STATUS.PUBLISHED]: 0, [EVENT_STATUS.FINISHED]: 1, [EVENT_STATUS.CANCELED]: 2 };
    return Object.values(groups).sort((a, b) => (order[a.status] ?? 0) - (order[b.status] ?? 0) || b.total - a.total);
  }, [tickets, me, eventDocs]);

  // Split by lifecycle so "Active events" really means live. Past and canceled
  // events stay reachable through the tabs instead of being mixed in.
  const liveEvents = eventStats.filter((e) => e.status === EVENT_STATUS.PUBLISHED);
  const pastEvents = eventStats.filter((e) => e.status === EVENT_STATUS.FINISHED);
  const canceledEvents = eventStats.filter((e) => e.status === EVENT_STATUS.CANCELED);
  const eventTabs = [
    { id: "live", label: "Live", list: liveEvents },
    { id: "past", label: "Past", list: pastEvents },
    { id: "canceled", label: "Canceled", list: canceledEvents },
    { id: "all", label: "All", list: eventStats },
  ];
  const currentTab = eventTabs.find((t) => t.id === eventFilter) ?? eventTabs[0];
  const filteredEvents = currentTab.list.filter((e) => e.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const totalSold = eventStats.reduce((a, e) => a + e.sold, 0);
  const totalMinted = eventStats.reduce((a, e) => a + e.total, 0);
  // Gross sales value = Σ (tickets sold × face price), computed DIRECTLY from the
  // Firestore event docs so it's stable: it counts every published event on its
  // own (eventStats groups by title, so same-titled events would otherwise
  // collapse and make this jump around when you add events). The on-chain
  // `organizerBalances` vault stays 0 in the zero-value demo, so this is what we
  // surface as the "Sales pool".
  const salesRevenue = eventDocs.reduce((a, e) => {
    const st = effectiveStatus(e);
    if (st === EVENT_STATUS.DRAFT || st === EVENT_STATUS.DELETED || !st) return a;
    return a + (Number(e.sold) || 0) * (parseFloat(e.priceEth) || 0);
  }, 0);

  // Sales graph data. Prefer real on-chain purchase logs (exact per-sale time),
  // but if none came back (public RPCs can reject the log query), fall back to
  // Firestore `sold` counts so the graph still reflects real sales for the demo
  // — one point per sold ticket, dated by the event.
  const salesSeriesForChart = useMemo(() => {
    if (salesSeries.length) return salesSeries;
    const pts = [];
    eventDocs.forEach((e) => {
      const st = effectiveStatus(e);
      if (st === EVENT_STATUS.DRAFT || st === EVENT_STATUS.DELETED || !st) return;
      const sold = Number(e.sold) || 0;
      const price = parseFloat(e.priceEth) || 0;
      const t = Number(e.timestamp) || Math.floor(Date.parse(e.publishedAt || e.updatedAt || e.createdAt || 0) / 1000) || 0;
      for (let i = 0; i < sold; i++) pts.push({ id: "", title: (e.headline || "Event").trim(), price, t });
    });
    return pts.sort((a, b) => a.t - b.t);
  }, [salesSeries, eventDocs]);

  // Small centered card wrapper used by the organizer auth/status screens.
  const Card = ({ children }) => (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center p-8 bg-white border border-slate-200 rounded-2xl shadow-sm">{children}</div>
    </div>
  );

  // While Privy boots or the embedded wallet address resolves for an already
  // signed-in user, show a spinner instead of flashing the sign-in card.
  if (!ready || (authenticated && !walletAddress)) {
    return (
      <Card>
        <div className="w-10 h-10 mx-auto border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 text-sm font-medium mt-4">Loading…</p>
      </Card>
    );
  }

  // ── Not signed in → single organizer sign-in (entry works out the rest) ──
  if (!walletAddress) {
    return (
      <Card>
        <div className="w-14 h-14 mx-auto mb-5 bg-indigo-600 rounded-2xl flex items-center justify-center">
          <Building2 className="text-white w-7 h-7" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 mb-2">Organizer portal</h1>
        <p className="text-slate-500 text-sm mb-6 leading-relaxed">
          Sign in to manage your events. New here? Sign in first — you can register your
          organisation right after, and an admin approves it before you can issue tickets.
        </p>
        <button onClick={connectWallet} className="w-full px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors">
          Sign in
        </button>
      </Card>
    );
  }

  if (orgStatus === "loading") {
    return (
      <Card>
        <div className="w-10 h-10 mx-auto border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 text-sm font-medium mt-4">Checking registration…</p>
      </Card>
    );
  }

  // ── Read failed (timeout / network) — let the user retry instead of hanging ──
  if (orgStatus === "error") {
    return (
      <Card>
        <div className="w-14 h-14 mx-auto mb-5 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-center">
          <ShieldAlert className="text-red-500 w-7 h-7" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 mb-2">Couldn't load your account</h1>
        <p className="text-slate-500 text-sm mb-6 leading-relaxed">
          We couldn't reach the database to check your organiser status. This is usually a temporary network issue.
        </p>
        <button onClick={checkOrgStatus} className="w-full px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2">
          <RefreshCw size={16} /> Retry
        </button>
      </Card>
    );
  }

  // ── ENTRY (/organizer) — one smart page: the status decides what renders ──
  if (mode !== "dashboard") {
    if (orgStatus === "unregistered")
      return <RegistrationForm walletAddress={walletAddress} onSubmitted={() => { setOrgStatusCache(walletAddress, "pending"); setOrgStatus("pending"); checkOrgStatus(); }} />;
    if (orgStatus === "pending") return <PendingScreen orgData={orgData} walletAddress={walletAddress} />;
    if (orgStatus === "rejected") return <RejectedScreen orgData={orgData} />;
    // Approved → straight into the dashboard, no extra clicks.
    return <Navigate to="/organizer/dashboard" replace />;
  }

  // ── DASHBOARD (mode === "dashboard") — safety net if not approved ──
  if (orgStatus !== "approved") return <Navigate to="/organizer" replace />;

  // ── Approved: Full Dashboard (sidebar layout) ──
  const navItems = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "events", label: "Events", icon: CalendarPlus },
    { id: "wallet", label: "My wallet", icon: Wallet },
    { id: "staff", label: "Staff", icon: Users },
  ];
  const sectionTitle = navItems.find((n) => n.id === section)?.label ?? "Overview";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row">

      {/* Sidebar */}
      <aside className="w-full md:w-64 shrink-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 md:min-h-screen flex flex-col md:sticky md:top-0 md:h-screen">
        <div className="p-5 border-b border-slate-200 flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <TicketIcon className="text-white w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 text-sm truncate">{orgData?.organizationName || "Organizer"}</p>
            <p className="text-xs text-slate-500">Organizer portal</p>
          </div>
        </div>

        <nav className="p-3 flex md:flex-col gap-1 overflow-x-auto">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setSection(id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                section === id ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>

        <div className="mt-auto p-3 border-t border-slate-200 hidden md:flex flex-col gap-1">
          <button onClick={() => navigate("/")} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors">
            <Home size={18} /> Back to site
          </button>
          {logout && (
            <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
              <LogOut size={18} /> Log out
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-slate-200 px-6 sm:px-8 h-16 flex items-center justify-between gap-4">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">{sectionTitle}</h1>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 text-xs font-semibold">
              <ShieldCheck size={13} /> Verified
            </span>
            <span className="hidden md:inline-flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-3 py-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${activeChainId === 31337 ? "bg-cyan-500" : "bg-emerald-500"}`} />
              {networkLabel}
            </span>
            {/* mobile-only logout (sidebar's is hidden on mobile) */}
            {logout && (
              <button onClick={handleLogout} className="md:hidden p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors">
                <LogOut size={18} />
              </button>
            )}
          </div>
        </header>

        <main className="p-6 sm:p-8 animate-in fade-in duration-300">

          {/* Approved in Firestore but missing from the contract whitelist — the
              admin's whitelistOrganizer tx failed or hasn't landed. Warn here
              instead of letting mints fail with an opaque revert. */}
          {onChainWhitelisted === false && (
            <div className="mb-6 max-w-6xl flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">On-chain activation still pending</p>
                <p className="text-sm text-amber-700 leading-relaxed">
                  Your account is approved, but your wallet hasn't been whitelisted on the {networkLabel} contract
                  yet — creating events and minting tickets will fail until that completes. Please contact the
                  admin to finish your on-chain approval.
                </p>
              </div>
            </div>
          )}

          {/* ───────────── OVERVIEW ───────────── */}
          {section === "overview" && (
            <div className="space-y-8 max-w-6xl">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <StatCard icon={<DollarSign />} label="Sales pool" value={rm(salesRevenue)} sub={`${ethLabel(salesRevenue, 3)} · ${totalSold} sold`} color="indigo" />
                <StatCard icon={<TicketIcon />} label="Tickets sold" value={`${totalSold} / ${totalMinted}`} sub="Across all events" color="emerald" />
                <StatCard icon={<ShieldAlert />} label="Active events" value={`${liveEvents.length}`}
                  sub={pastEvents.length || canceledEvents.length
                    ? [pastEvents.length && `${pastEvents.length} past`, canceledEvents.length && `${canceledEvents.length} canceled`].filter(Boolean).join(" · ")
                    : "On sale now"}
                  color="amber" />
              </div>

              {/* Sales polygraph — every on-chain ticket purchase over time */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <TrendingUp size={16} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Sales activity</h3>
                    <p className="text-xs text-slate-500">On-chain purchases · price and time per ticket</p>
                  </div>
                </div>
                <SalesChart series={salesSeriesForChart} />
              </div>

              <div>
                {/* Sales analytics for the organizer's published events */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col self-start">
                  <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-semibold text-slate-900">Your events</h3>
                      <span className="text-xs text-slate-500">
                        {currentTab.list.length} {currentTab.id === "all" ? "total" : currentTab.label.toLowerCase()}
                      </span>
                    </div>
                    <button onClick={() => setSection("events")} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-colors">
                      <Plus size={15} /> New event
                    </button>
                  </div>
                  {/* Lifecycle tabs — only shown once there's history beyond live events */}
                  {(pastEvents.length > 0 || canceledEvents.length > 0) && (
                    <div className="px-4 pt-4 flex items-center gap-1.5 flex-wrap">
                      {eventTabs.filter((t) => t.id === "live" || t.list.length > 0).map((t) => (
                        <button key={t.id} onClick={() => setEventFilter(t.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                            eventFilter === t.id
                              ? "bg-indigo-600 border-indigo-600 text-white"
                              : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-slate-900"}`}>
                          {t.label} <span className={eventFilter === t.id ? "text-indigo-200" : "text-slate-400"}>{t.list.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {eventStats.length > 0 && (
                    <div className="p-4 border-b border-slate-100">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input type="text" placeholder="Search events" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all" />
                      </div>
                    </div>
                  )}
                  <div className="p-4 space-y-3 overflow-y-auto max-h-[560px]">
                    {filteredEvents.map((ev) => {
                      const pct = ev.total > 0 ? Math.round((ev.sold / ev.total) * 100) : 0;
                      const dateLabel = formatEventDate(ev.timestamp);
                      const banner = ev.imageHash ? ipfsToHttp(ev.imageHash) : "";
                      return (
                        <div key={ev.title} className="bg-slate-50 border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors">
                          <div className="flex justify-between items-start gap-4 mb-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="w-11 h-11 rounded-lg overflow-hidden bg-slate-200 shrink-0 flex items-center justify-center">
                                {banner
                                  ? <img src={banner} alt="" className="w-full h-full object-cover" />
                                  : <TicketIcon className="w-5 h-5 text-slate-400" />}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="text-slate-900 font-semibold text-sm truncate">{ev.title}</h4>
                                  <EventStatusBadge status={ev.status} />
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {rm(ev.price)} <span className="text-slate-400">({ethLabel(ev.price, 3)})</span> / ticket{dateLabel ? ` · ${dateLabel}` : ""}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xl font-bold text-emerald-600">{ev.sold}<span className="text-slate-400 text-sm font-semibold">/{ev.total}</span></p>
                              <p className="text-xs text-slate-500">Sold ({pct}%)</p>
                            </div>
                          </div>
                          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mb-3">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <MiniStat value={ev.available} label="Available" />
                            <MiniStat value={ev.sold} label="Sold" valueClass="text-emerald-600" />
                            <MiniStat value={ev.redeemed} label="Redeemed" valueClass="text-red-500" />
                          </div>
                        </div>
                      );
                    })}
                    {eventStats.length > 0 && filteredEvents.length === 0 && searchQuery && (
                      <div className="p-16 text-center text-slate-400">
                        <Search className="w-9 h-9 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">No events match “{searchQuery}”.</p>
                      </div>
                    )}
                    {eventStats.length > 0 && filteredEvents.length === 0 && !searchQuery && (
                      <div className="p-16 text-center text-slate-400">
                        <TicketIcon className="w-9 h-9 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">
                          {currentTab.id === "live" ? "No live events right now." : `No ${currentTab.label.toLowerCase()} events.`}
                        </p>
                      </div>
                    )}
                    {eventStats.length === 0 && (
                      <div className="p-16 text-center">
                        <TicketIcon className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                        <p className="text-sm text-slate-500 font-medium">No published events yet</p>
                        <p className="text-xs text-slate-400 mt-1 mb-5">Publish an event and it will show up here with live sales.</p>
                        <button onClick={() => setSection("events")} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-colors">
                          <Plus size={15} /> Create your first event
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ───────────── EVENTS (draft → preview → publish) ───────────── */}
          {section === "events" && (
            <EventWizard
              wallet={wallet}
              walletAddress={walletAddress}
              orgData={orgData}
              isPaused={isPaused}
              activeChainId={activeChainId}
              onPublished={fetchDashboardData}
            />
          )}

          {/* ───────────── MY WALLET ───────────── */}
          {section === "wallet" && (
            <div className="space-y-6 max-w-5xl">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Balance */}
                <div className="lg:col-span-2 relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-50 to-white p-8 flex flex-col justify-between min-h-[280px]">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white"><Wallet size={20} /></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Organizer wallet</p>
                        <p className="text-xs text-slate-500">Embedded · self-custodial</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600">
                      <span className={`w-1.5 h-1.5 rounded-full ${activeChainId === 31337 ? "bg-cyan-500" : "bg-emerald-500"}`} />
                      {networkLabel}
                    </span>
                  </div>
                  <div className="my-6">
                    <p className="text-sm text-slate-500 mb-1">Balance</p>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-5xl font-bold tracking-tight text-slate-900 tabular-nums">
                        {isFetchingBalance ? <span className="inline-block animate-pulse w-28 h-12 bg-slate-200 rounded-lg align-middle" /> : parseFloat(ethBalance).toFixed(4)}
                      </span>
                      <span className="text-xl font-semibold text-slate-400">ETH</span>
                      <button onClick={fetchDashboardData} disabled={isFetchingBalance} className="ml-2 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors cursor-pointer" title="Refresh balance">
                        <RefreshCw size={16} className={isFetchingBalance ? "animate-spin" : ""} />
                      </button>
                    </div>
                    <p className="text-sm text-slate-500 mt-1">≈ {rm(ethBalance)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-4 pt-5 border-t border-slate-200">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 mb-0.5">Wallet address</p>
                      <p className="font-mono text-sm text-slate-700 truncate">{walletAddress}</p>
                    </div>
                    <button onClick={handleCopyAddress} className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${copied ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"}`}>
                      {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                    </button>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 flex flex-col justify-between min-h-[280px]">
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-4">Quick actions</h3>
                    <div className="space-y-3">
                      <button onClick={() => setShowSendModal(true)} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors">
                        <Send size={15} /> Send ETH
                      </button>
                      <button onClick={() => setShowReceiveModal(true)} className="w-full py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors">
                        <QrCode size={15} /> Receive
                      </button>
                    </div>
                  </div>
                  <div className="mt-6 pt-5 border-t border-slate-200">
                    {activeChainId === 31337 ? (
                      <>
                        <div className="flex gap-2 items-start mb-3">
                          <Info size={15} className="mt-0.5 shrink-0 text-cyan-600" />
                          <p className="text-xs text-slate-500 leading-relaxed">On the local node — fund this wallet with 10 test ETH instantly.</p>
                        </div>
                        <button onClick={handleLocalhostFaucet} disabled={localhostFaucetLoading} className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer">
                          {localhostFaucetLoading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Get 10 test ETH"}
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex gap-2 items-start mb-3">
                          <Info size={15} className="mt-0.5 shrink-0 text-amber-500" />
                          <p className="text-xs text-slate-500 leading-relaxed">Need test ETH for gas? Grab free Sepolia ETH from a faucet.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <a href="https://sepolia-faucet.pk910.de/" target="_blank" rel="noopener noreferrer" className="py-2 px-3 bg-white border border-slate-200 hover:bg-slate-50 hover:text-indigo-600 text-xs font-semibold text-slate-600 rounded-lg transition-colors flex items-center justify-center gap-1">
                            PoW faucet <ExternalLink size={11} />
                          </a>
                          <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noopener noreferrer" className="py-2 px-3 bg-white border border-slate-200 hover:bg-slate-50 hover:text-indigo-600 text-xs font-semibold text-slate-600 rounded-lg transition-colors flex items-center justify-center gap-1">
                            Alchemy <ExternalLink size={11} />
                          </a>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Revenue vault */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm max-w-xl">
                <div className="flex items-center gap-2 pb-4 border-b border-slate-100 mb-4">
                  <Landmark className="text-teal-600 w-5 h-5" />
                  <h3 className="text-base font-semibold text-slate-900">Revenue vault</h3>
                </div>
                <div className="flex items-end justify-between mb-4">
                  <div>
                    <p className="text-sm text-slate-500">Available to withdraw</p>
                    <p className="text-2xl font-bold text-slate-900">{parseFloat(totalRevenue).toFixed(4)} <span className="text-base font-medium text-slate-400">ETH</span></p>
                    <p className="text-xs text-slate-400">≈ {rm(totalRevenue)}</p>
                  </div>
                </div>
                <button onClick={handleWithdraw} disabled={parseFloat(totalRevenue) <= 0 || isPaused || withdrawLoading} className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-400 text-white py-3.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                  {withdrawLoading ? <><RefreshCw size={14} className="animate-spin" /> Withdrawing…</> : "Withdraw funds"}
                </button>
              </div>
            </div>
          )}

          {/* ───────────── STAFF ───────────── */}
          {section === "staff" && (
            <div className="space-y-6 max-w-3xl">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-2 pb-4 border-b border-slate-100 mb-5">
                  <UserPlus className="text-indigo-600 w-5 h-5" />
                  <h3 className="text-base font-semibold text-slate-900">Assign door staff</h3>
                </div>
                <p className="text-sm text-slate-500 mb-4 leading-relaxed">
                  Add staff by email. When they sign in with that email, they get access to the
                  <span className="font-medium text-slate-700"> gate scanner</span> to validate tickets at your events.
                </p>
                <form onSubmit={addStaff} className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="email" value={staffEmail}
                      onChange={(e) => { setStaffEmail(e.target.value); setStaffError(""); }}
                      placeholder="jane@venue.com"
                      className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                    />
                  </div>
                  <button type="submit" disabled={addStaffLoading} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 shrink-0">
                    {addStaffLoading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><UserPlus size={16} /> Add staff</>}
                  </button>
                </form>
                {staffError && <p className="text-red-600 text-sm mt-2">{staffError}</p>}
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="text-slate-400 w-5 h-5" />
                    <h3 className="text-base font-semibold text-slate-900">Your staff</h3>
                    <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 text-sm font-semibold rounded-full">{staffList.length}</span>
                  </div>
                  <button onClick={loadStaff} disabled={staffLoading} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors" title="Refresh">
                    <RefreshCw size={15} className={staffLoading ? "animate-spin" : ""} />
                  </button>
                </div>

                {staffList.length === 0 ? (
                  <div className="p-12 text-center">
                    <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-600 font-semibold">No staff yet</p>
                    <p className="text-slate-400 text-sm mt-1">Add door staff above so they can scan tickets at your events.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {staffList.map((s) => (
                      <li key={s.email} className="flex items-center justify-between gap-4 px-5 py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                            <User size={17} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{s.email}</p>
                            <p className="text-xs text-slate-400">Added {s.addedAt ? new Date(s.addedAt).toLocaleDateString() : "—"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-xs font-semibold">
                            <ShieldCheck size={12} /> Gate
                          </span>
                          <button onClick={() => removeStaff(s.email)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MODALS */}
      <AnimatePresence>
        {showSendModal && (
          <Modal onClose={() => setShowSendModal(false)} icon={<Send size={20} />} title="Send ETH" subtitle={networkLabel}>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Recipient address</label>
              <input type="text" value={sendRecipient} onChange={(e) => setSendRecipient(e.target.value)} placeholder="0x…"
                className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 text-sm font-mono text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount (ETH)</label>
              <input type="number" step="0.001" min="0" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} placeholder="0.0"
                className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all" />
              <p className="text-xs text-slate-500 mt-1.5 text-right">Available: {parseFloat(ethBalance).toFixed(4)} ETH</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowSendModal(false)} className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-semibold text-sm transition-colors">Cancel</button>
              <button onClick={onSendEth} disabled={!sendRecipient || !sendAmount || isSendingEth || parseFloat(sendAmount) > parseFloat(ethBalance)}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer">
                {isSendingEth ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Send"}
              </button>
            </div>
          </Modal>
        )}

        {showReceiveModal && (
          <Modal onClose={() => setShowReceiveModal(false)} icon={<QrCode size={20} />} title="Receive ETH" subtitle="Share your address">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs text-slate-500 mb-1.5">Your address</p>
              <p className="font-mono text-xs text-slate-900 break-all">{walletAddress}</p>
              <button onClick={handleCopyAddress} className={`mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${copied ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy address</>}
              </button>
            </div>
            <p className="text-xs text-slate-500 text-center leading-relaxed">Send only ETH on the {networkLabel}. Other tokens may be lost.</p>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────
const StatCard = ({ icon, label, value, sub, color }) => {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
  };
  return (
    <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex items-center gap-5">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${tones[color] || tones.indigo}`}>
        {React.cloneElement(icon, { size: 22 })}
      </div>
      <div className="min-w-0">
        <p className="text-slate-500 text-sm">{label}</p>
        <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{value}</h3>
        <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
      </div>
    </div>
  );
};

const MiniStat = ({ value, label, valueClass = "text-slate-900" }) => (
  <div className="bg-white rounded-lg py-2 border border-slate-200">
    <p className={`text-sm font-bold ${valueClass}`}>{value}</p>
    <p className="text-xs text-slate-500">{label}</p>
  </div>
);

// Compact event date (seconds epoch) for the overview cards.
const formatEventDate = (ts) =>
  ts ? new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

// Coloured pill for the effective event lifecycle status.
const EventStatusBadge = ({ status }) => {
  const map = {
    [EVENT_STATUS.PUBLISHED]: { label: "Live", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    [EVENT_STATUS.FINISHED]: { label: "Past", cls: "bg-slate-100 text-slate-500 border-slate-200" },
    [EVENT_STATUS.CANCELED]: { label: "Canceled", cls: "bg-red-50 text-red-600 border-red-200" },
  };
  const s = map[status] || map[EVENT_STATUS.PUBLISHED];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {s.label}
    </span>
  );
};

// Full date+time for a sale point (multiple sales can land on the same day).
const formatSaleTime = (t) =>
  t ? new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

// ─── Sales polygraph ─────────────────────────────────────────────────────────
// A dependency-free SVG line chart of every on-chain ticket purchase. Toggle
// between cumulative revenue (the line climbs with each sale) and the individual
// price paid per sale. Hovering a point reveals the ticket, its price, and when
// it sold. `series` is pre-sorted oldest→newest: [{ id, title, price, t }].
const SalesChart = ({ series }) => {
  const [metric, setMetric] = useState("revenue"); // "revenue" | "price"
  const [hover, setHover] = useState(null);

  const count = series.length;
  const totalRevenue = series.reduce((a, s) => a + s.price, 0);

  if (count === 0) {
    return (
      <div className="p-12 text-center">
        <TrendingUp className="w-9 h-9 mx-auto mb-3 text-slate-300" />
        <p className="text-sm text-slate-500 font-medium">No sales yet</p>
        <p className="text-xs text-slate-400 mt-1">Every ticket purchase will plot here — price and time included.</p>
      </div>
    );
  }

  // viewBox geometry. The wrapper is locked to the same aspect ratio (8:3) so
  // percentage-positioned HTML tooltips line up with the SVG coordinates.
  const W = 640, H = 240, padL = 14, padR = 14, padT = 16, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  const cumulative = series.reduce((acc, s) => { acc.push((acc[acc.length - 1] || 0) + s.price); return acc; }, []);
  const points = series.map((s, i) => {
    const cumRevenue = cumulative[i];
    return { ...s, i, ticketNo: i + 1, cumRevenue, yVal: metric === "revenue" ? cumRevenue : s.price };
  });
  const maxY = Math.max(...points.map((p) => p.yVal), 1e-9);

  const px = (i) => padL + (count === 1 ? innerW / 2 : (i / (count - 1)) * innerW);
  const py = (v) => padT + innerH - (v / maxY) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(p.yVal).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${px(count - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L ${px(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

  const gridYs = [0, 0.5, 1];
  const active = hover != null ? points[hover] : null;

  return (
    <div>
      {/* header: summary + metric toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-xs text-slate-500">Tickets sold</p>
            <p className="text-lg font-bold text-slate-900">{count.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total revenue</p>
            <p className="text-lg font-bold text-slate-900">{rm(totalRevenue)}</p>
            <p className="text-[11px] text-slate-400">{ethLabel(totalRevenue, 3)}</p>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold self-start">
          <button
            onClick={() => { setMetric("revenue"); setHover(null); }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${metric === "revenue" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            <TrendingUp size={13} /> Cumulative
          </button>
          <button
            onClick={() => { setMetric("price"); setHover(null); }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${metric === "price" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            <BarChart3 size={13} /> Per sale
          </button>
        </div>
      </div>

      {/* chart */}
      <div className="relative w-full aspect-[8/3]">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full overflow-visible" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* horizontal gridlines + y labels */}
          {gridYs.map((g) => {
            const yy = padT + innerH - g * innerH;
            return (
              <g key={g}>
                <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#e2e8f0" strokeWidth="1" strokeDasharray={g === 0 ? "0" : "4 4"} />
                <text x={W - padR} y={yy - 4} textAnchor="end" className="fill-slate-400" fontSize="10">{rm(maxY * g)}</text>
              </g>
            );
          })}

          <path d={areaPath} fill="url(#salesFill)" />
          <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

          {/* active guide line */}
          {active && (
            <line x1={px(active.i)} y1={padT} x2={px(active.i)} y2={padT + innerH} stroke="#6366f1" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          )}

          {/* points + hover hit areas */}
          {points.map((p) => (
            <g key={p.i}>
              <circle cx={px(p.i)} cy={py(p.yVal)} r={active && active.i === p.i ? 5 : 3} fill="#fff" stroke="#6366f1" strokeWidth="2" />
              <circle
                cx={px(p.i)} cy={py(p.yVal)} r="14" fill="transparent"
                onMouseEnter={() => setHover(p.i)} onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              />
            </g>
          ))}
        </svg>

        {/* hover tooltip (HTML overlay, positioned via viewBox percentages) */}
        {active && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full"
            style={{ left: `${(px(active.i) / W) * 100}%`, top: `${(py(active.yVal) / H) * 100 - 3}%` }}
          >
            <div className="rounded-lg bg-slate-900 text-white px-3 py-2 shadow-lg whitespace-nowrap">
              <p className="text-xs font-semibold">{active.title}</p>
              <p className="text-[11px] text-slate-300">{active.id ? `Ticket #${active.id} · ` : ""}sale {active.ticketNo} of {count}</p>
              <p className="text-sm font-bold mt-0.5">{rm(active.price)} <span className="text-[11px] font-medium text-slate-400">({ethLabel(active.price, 3)})</span></p>
              {metric === "revenue" && <p className="text-[11px] text-emerald-300">Running total {rm(active.cumRevenue)}</p>}
              <p className="text-[11px] text-slate-400 mt-0.5">{formatSaleTime(active.t)}</p>
            </div>
          </div>
        )}
      </div>

      {/* x-axis range */}
      <div className="flex justify-between mt-2 text-[11px] text-slate-400">
        <span>{formatSaleTime(points[0].t)}</span>
        {count > 1 && <span>{formatSaleTime(points[count - 1].t)}</span>}
      </div>
    </div>
  );
};

const Modal = ({ children, onClose, icon, title, subtitle }) => (
  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[1000]" onClick={onClose}>
    <motion.div
      initial={{ scale: 0.96, opacity: 0, y: 12 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.96, opacity: 0, y: 12 }}
      transition={{ duration: 0.18 }}
      onClick={(e) => e.stopPropagation()}
      className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl relative"
    >
      <div className="flex items-center gap-3 p-6 border-b border-slate-100">
        {icon && <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">{icon}</div>}
        <div className="min-w-0">
          {title && <h3 className="text-lg font-semibold text-slate-900 leading-tight">{title}</h3>}
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><X size={20} /></button>
      </div>
      <div className="p-6 space-y-5">{children}</div>
    </motion.div>
  </div>
);

export default OrganizerDashboard;
