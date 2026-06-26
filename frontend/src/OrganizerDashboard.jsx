import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { ethers } from "ethers";
import {
  Landmark, ShieldAlert, Ticket as TicketIcon,
  Trash2, DollarSign, RefreshCw,
  Clock, CheckCircle2, XCircle, FileText, Building2, Mail, User, Tag, Search, Info, LogOut, Home,
  Wallet, Send, QrCode, Copy, Check, ExternalLink, LayoutDashboard, Users, UserPlus, ShieldCheck, X,
  CalendarPlus, Plus
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { CONTRACT_ADDRESS, CONTRACT_ABI, START_BLOCK, getContractAddress } from "./constants";
import { db } from "./firebase";
import { doc, setDoc, getDoc, deleteDoc, collection, query, where, getDocs } from "firebase/firestore";
import { fetchOrgStatus, getCachedOrgStatus, setOrgStatusCache } from "./orgStatus";
import EventWizard from "./EventWizard";

const USD_PER_ETH = 3500; // rough display-only conversion
const usd = (eth) =>
  `$${(parseFloat(eth || 0) * USD_PER_ETH).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ─── Registration Form ────────────────────────────────────────────────────────
const RegistrationForm = ({ walletAddress, onSubmitted }) => {
  const [form, setForm] = useState({
    legalName: "", organizationName: "", email: "", eventType: "", description: ""
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
        setError("Request timed out. Check your internet connection and that Firestore is in Test Mode.");
      } else if (err.code === "permission-denied") {
        setError("Permission denied. Make sure Firestore is set to Test Mode in Firebase Console.");
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

const PendingScreen = ({ orgData }) => (
  <StatusScreen tone="amber" icon={<Clock size={40} className="animate-pulse" />} title="Application pending"
    details={
      <>
        <DetailRow label="Name" value={orgData?.legalName} />
        <DetailRow label="Organisation" value={orgData?.organizationName} />
        <DetailRow label="Event type" value={orgData?.eventType} valueClass="text-amber-600" />
        <DetailRow label="Status" value="Pending review" valueClass="text-amber-600" />
      </>
    }>
    Your organiser application for <span className="text-slate-900 font-semibold">{orgData?.organizationName}</span> is
    under review. An admin will approve or reject it shortly.
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
  // Off-chain event docs (the Firestore `sold` counter buyers see at checkout /
  // on the storefront). Merged into the on-chain stats so every view agrees.
  const [eventDocs, setEventDocs] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [voidingTickets, setVoidingTickets] = useState({});
  const [activeChainId, setActiveChainId] = useState(11155111);
  const [localhostFaucetLoading, setLocalhostFaucetLoading] = useState(false);

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

  const fetchDashboardData = async () => {
    if (!wallet || !walletAddress) return;
    try {
      const eip1193Provider = await wallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(eip1193Provider);

      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      const startBlock = currentChainId === 11155111 ? START_BLOCK : 0;

      setActiveChainId(currentChainId);
      const contractAddress = getContractAddress(currentChainId);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);

      const paused = await contract.paused();
      setIsPaused(paused);

      // Personal wallet balance for the "My Wallet" section
      setIsFetchingBalance(true);
      try {
        const bal = await provider.getBalance(walletAddress);
        setEthBalance(ethers.formatEther(bal));
      } catch (balErr) {
        console.error("Error fetching balance:", balErr);
      } finally {
        setIsFetchingBalance(false);
      }

      const balance = await contract.organizerBalances(walletAddress);
      setTotalRevenue(ethers.formatEther(balance));

      const filter = contract.filters.TicketMinted(null, walletAddress);
      const logs = await contract.queryFilter(filter, startBlock);

      let tempVoided = 0;
      const ticketList = (await Promise.all(logs.map(async (log) => {
        try {
          const id = log.args[0];
          const details = await contract.getTicketDetails(id);
          const owner = await contract.ownerOf(id);
          if (details.isUsed) tempVoided++;
          return {
            id: id.toString(),
            eventTitle: details.eventName || `Ticket #${id}`,
            mintPrice: ethers.formatEther(details.originalPrice || 0n),
            isUsed: details.isUsed || false,
            isListed: details.isForResale || false,
            owner: owner,
            category: "VIP"
          };
        } catch (ticketErr) {
          console.warn(`Gracefully skipped sync for organizer ticket:`, ticketErr);
          return null;
        }
      }))).filter(Boolean);

      setTickets(ticketList);
      setDeployedStock(ticketList.length);
      setVoidedCount(tempVoided);

      // Pull the off-chain sold counters in the same refresh so the dashboard's
      // "sold / total" stays in sync with the storefront and checkout pages.
      try {
        const evSnap = await getDocs(query(collection(db, "events"), where("organiserId", "==", walletAddress)));
        setEventDocs(evSnap.docs.map((d) => d.data()));
      } catch (evErr) {
        console.warn("Event docs load failed:", evErr?.message);
      }
    } catch (error) {
      console.error("Dashboard Sync Error:", error);
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
  // Firestore sold/supply keyed by event title (the on-chain `eventName` equals
  // the Firestore `headline`), so we can reconcile the two sources below.
  const fsByTitle = useMemo(() => {
    const m = {};
    eventDocs.forEach((e) => {
      const title = (e.headline || "").trim();
      if (title) m[title] = { supply: Number(e.aggregateSupply) || 0, sold: Number(e.sold) || 0 };
    });
    return m;
  }, [eventDocs]);

  const eventStats = useMemo(() => {
    const groups = {};
    tickets.forEach((t) => {
      const title = (t.eventTitle || "Untitled").split(" #")[0];
      if (!groups[title]) groups[title] = { title, price: t.mintPrice, total: 0, sold: 0, available: 0, redeemed: 0 };
      const g = groups[title];
      g.total += 1;
      if (t.isUsed) g.redeemed += 1;
      if (t.owner && t.owner.toLowerCase() !== me) g.sold += 1;
      else if (!t.isUsed) g.available += 1;
    });
    // Prefer the off-chain counter (the number buyers see on the storefront and
    // at checkout) for total/sold so all three views show identical counts.
    // `redeemed` stays on-chain — it's the live gate state, not tracked off-chain.
    Object.values(groups).forEach((g) => {
      const fs = fsByTitle[g.title];
      if (fs) {
        if (fs.supply) g.total = fs.supply;
        g.sold = fs.sold;
        g.available = Math.max(0, g.total - g.sold);
      }
    });
    return Object.values(groups).sort((a, b) => b.total - a.total);
  }, [tickets, me, fsByTitle]);

  const filteredEvents = eventStats.filter((e) => e.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const totalSold = eventStats.reduce((a, e) => a + e.sold, 0);
  const totalMinted = eventStats.reduce((a, e) => a + e.total, 0);

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

  // ── Not signed in → organizer-specific sign-in (copy differs per page) ──
  if (!walletAddress) {
    const isRegister = mode === "register";
    return (
      <Card>
        <div className="w-14 h-14 mx-auto mb-5 bg-indigo-600 rounded-2xl flex items-center justify-center">
          <Building2 className="text-white w-7 h-7" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 mb-2">
          {isRegister ? "Register as an organizer" : "Organizer login"}
        </h1>
        <p className="text-slate-500 text-sm mb-6 leading-relaxed">
          {isRegister
            ? "Sign in to create your organizer account, then submit your organisation details for admin review."
            : "Sign in to your organizer account to access your dashboard."}
        </p>
        <button onClick={connectWallet} className="w-full px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors">
          {isRegister ? "Sign in to register" : "Sign in"}
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

  // ── REGISTRATION PAGE (/organizer/register) ──
  if (mode === "register") {
    if (orgStatus === "unregistered")
      return <RegistrationForm walletAddress={walletAddress} onSubmitted={() => { setOrgStatusCache(walletAddress, "pending"); setOrgStatus("pending"); checkOrgStatus(); }} />;
    if (orgStatus === "pending") return <PendingScreen orgData={orgData} />;
    if (orgStatus === "rejected") return <RejectedScreen orgData={orgData} />;
    // Already approved → direct them to the login page.
    return (
      <Card>
        <div className="w-14 h-14 mx-auto mb-5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-center">
          <CheckCircle2 className="text-emerald-500 w-7 h-7" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 mb-2">Already registered</h1>
        <p className="text-slate-500 text-sm mb-6 leading-relaxed">Your organisation is already approved. Use the organizer login to access your dashboard.</p>
        <button onClick={() => navigate("/organizer/login")} className="w-full px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors">
          Go to organizer login →
        </button>
      </Card>
    );
  }

  // ── LOGIN PAGE (/organizer/login) ──
  if (mode === "login") {
    if (orgStatus === "unregistered")
      return (
        <Card>
          <div className="w-14 h-14 mx-auto mb-5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center">
            <FileText className="text-amber-500 w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 mb-2">No organizer account</h1>
          <p className="text-slate-500 text-sm mb-6 leading-relaxed">This account hasn't registered as an organizer yet. Register first, then wait for an admin to approve you.</p>
          <button onClick={() => navigate("/organizer/register")} className="w-full px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors">
            Register as organizer →
          </button>
        </Card>
      );
    if (orgStatus === "pending") return <PendingScreen orgData={orgData} />;
    if (orgStatus === "rejected") return <RejectedScreen orgData={orgData} />;
    // Approved → go straight into the dashboard (no confirmation step).
    return <Navigate to="/organizer/dashboard" replace />;
  }

  // ── DASHBOARD (mode === "dashboard") — safety net if not approved ──
  if (orgStatus !== "approved") return <Navigate to="/organizer/login" replace />;

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
            <button onClick={logout} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
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
              <button onClick={logout} className="md:hidden p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors">
                <LogOut size={18} />
              </button>
            )}
          </div>
        </header>

        <main className="p-6 sm:p-8 animate-in fade-in duration-300">

          {/* ───────────── OVERVIEW ───────────── */}
          {section === "overview" && (
            <div className="space-y-8 max-w-6xl">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <StatCard icon={<DollarSign />} label="Sales pool" value={`${parseFloat(totalRevenue).toFixed(3)} ETH`} sub="Escrowed in contract" color="indigo" />
                <StatCard icon={<TicketIcon />} label="Tickets sold" value={`${totalSold} / ${totalMinted}`} sub="Across all events" color="emerald" />
                <StatCard icon={<ShieldAlert />} label="Active events" value={`${eventStats.length}`} sub="Currently issued" color="amber" />
              </div>

              <div>
                {/* On-chain sales analytics (published/minted events) */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col self-start">
                  <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-semibold text-slate-900">Active events</h3>
                      <span className="text-xs text-slate-500">{eventStats.length} on-chain</span>
                    </div>
                    <button onClick={() => setSection("events")} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-colors">
                      <Plus size={15} /> New event
                    </button>
                  </div>
                  <div className="p-4 border-b border-slate-100">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input type="text" placeholder="Search events" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all" />
                    </div>
                  </div>
                  <div className="p-4 space-y-3 overflow-y-auto max-h-[560px]">
                    {filteredEvents.map((ev) => {
                      const pct = ev.total > 0 ? Math.round((ev.sold / ev.total) * 100) : 0;
                      return (
                        <div key={ev.title} className="bg-slate-50 border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <h4 className="text-slate-900 font-semibold text-sm">{ev.title}</h4>
                              <p className="text-xs text-slate-500 mt-0.5">{ev.price} ETH / ticket</p>
                            </div>
                            <div className="text-right">
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
                    {filteredEvents.length === 0 && (
                      <div className="p-16 text-center text-slate-400">
                        <TicketIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">No published events yet. Create one from the Events tab.</p>
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
                    <p className="text-sm text-slate-500 mt-1">≈ {usd(ethBalance)}</p>
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
                    <p className="text-xs text-slate-400">≈ {usd(totalRevenue)}</p>
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
