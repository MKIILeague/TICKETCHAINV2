import React, { useState } from "react";
import { ethers } from "ethers";
import {
  CheckCircle2, XCircle, Search, ShieldCheck, RefreshCw,
  Camera, User, Ticket as TicketIcon, RotateCcw,
  Hash, Activity, LogIn, Wifi, WifiOff, DoorOpen
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Scanner } from '@yudiel/react-qr-scanner';
import { CONTRACT_ABI, getContractAddress } from "./constants";
import { fetchEventStatusByName, isSaleBlocked, EVENT_STATUS } from "./eventStatus";

const GatekeeperTerminal = ({ walletAddress, wallet, connectWallet }) => {
  const [tokenId, setTokenId] = useState("");
  const [ticketDetails, setTicketDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState("IDLE"); // IDLE, VALID, INVALID, CONSUMED, EVENT_BLOCKED
  const [eventStatus, setEventStatus] = useState(null);  // canceled | finished when EVENT_BLOCKED
  const [isScanning, setIsScanning] = useState(false);
  // Real session counters (replaces the old placeholder footer numbers).
  const [stats, setStats] = useState({ scanned: 0, admitted: 0, denied: 0 });
  const [netLabel, setNetLabel] = useState("Sepolia");

  const resetScan = () => {
    setScanStatus("IDLE");
    setTicketDetails(null);
    setEventStatus(null);
    setTokenId("");
  };

  const handleScan = async (e, overrideTokenId = null) => {
    if (e) e.preventDefault();
    const targetId = overrideTokenId || tokenId;
    if (!targetId || !wallet) return;

    setLoading(true);
    setScanStatus("IDLE");
    try {
      let eip1193Provider = await wallet.getEthereumProvider();
      let provider = new ethers.BrowserProvider(eip1193Provider);

      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      const targetChainId = (currentChainId === 31337 || currentChainId === 11155111) ? currentChainId : 11155111;
      setNetLabel(targetChainId === 31337 ? "Localhost" : "Sepolia");

      if (currentChainId !== targetChainId) {
        await wallet.switchChain(targetChainId);
        eip1193Provider = await wallet.getEthereumProvider();
        provider = new ethers.BrowserProvider(eip1193Provider);
      }

      const contractAddress = getContractAddress(targetChainId);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);

      const details = await contract.getTicketDetails(targetId);
      const owner = await contract.ownerOf(targetId);

      setTicketDetails({
        id: targetId,
        eventName: details.eventName,
        isUsed: details.isUsed,
        owner: owner
      });

      // Lifecycle gate — a canceled or finished event denies entry regardless of
      // the on-chain ticket state. Check Firestore status FIRST so we never wave
      // through a valid QR for a dead event.
      const evStatus = await fetchEventStatusByName(details.eventName);
      if (isSaleBlocked(evStatus)) {
        setEventStatus(evStatus);
        setScanStatus("EVENT_BLOCKED");
        setStats((s) => ({ ...s, scanned: s.scanned + 1, denied: s.denied + 1 }));
      } else if (details.isUsed) {
        setScanStatus("CONSUMED");
        setStats((s) => ({ ...s, scanned: s.scanned + 1, denied: s.denied + 1 }));
      } else {
        setScanStatus("VALID");
        setStats((s) => ({ ...s, scanned: s.scanned + 1 }));
      }
    } catch (error) {
      console.error("Scan failed:", error);
      setScanStatus("INVALID");
      setTicketDetails(null);
      setStats((s) => ({ ...s, scanned: s.scanned + 1, denied: s.denied + 1 }));
    } finally {
      setLoading(false);
    }
  };

  const handleUseTicket = async () => {
    if (!ticketDetails || ticketDetails.isUsed || !wallet) return;

    // Re-check lifecycle before spending gas — block voiding for a dead event.
    const evStatus = await fetchEventStatusByName(ticketDetails.eventName);
    if (isSaleBlocked(evStatus)) {
      setEventStatus(evStatus);
      setScanStatus("EVENT_BLOCKED");
      return;
    }

    try {
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

      // Pre-flight gas check
      const balance = await provider.getBalance(walletAddress);
      const balanceInEth = parseFloat(ethers.formatEther(balance));
      const requiredGas = 0.0003; // Safe margin

      if (balanceInEth < requiredGas) {
        alert(`❌ Insufficient funds for gas!\n\nYou currently have ${balanceInEth.toFixed(4)} ETH, but you need at least ${requiredGas} ETH to send this transaction.\n\nPlease fund your wallet before trying again.`);
        return;
      }

      const signer = await provider.getSigner();
      const contractAddress = getContractAddress(targetChainId);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

      const tx = await contract.useTicket(ticketDetails.id);
      await tx.wait();

      setScanStatus("CONSUMED");
      setTicketDetails({ ...ticketDetails, isUsed: true });
      setStats((s) => ({ ...s, admitted: s.admitted + 1 }));
      alert("Entry recorded! Ticket voided.");
    } catch (error) {
      console.error("Use ticket failed:", error);
      alert(error.reason || error.message || "Transaction failed");
    }
  };

  const short = (a) => (a ? `${a.substring(0, 6)}…${a.substring(a.length - 4)}` : "");

  return (
    <div className="relative min-h-screen bg-[#070b14] text-slate-200 font-sans overflow-hidden">
      {/* ambient glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[560px] h-[560px] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[420px] h-[420px] rounded-full bg-violet-700/10 blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.04] bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:44px_44px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center px-5 py-8 sm:py-12">
        {/* ── Header ── */}
        <header className="w-full max-w-lg mb-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 rounded-2xl bg-indigo-500 blur-md opacity-40" />
                <div className="relative inline-flex p-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg">
                  <ShieldCheck size={26} />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-black text-white tracking-tight leading-none">Gate Verifier</h1>
                <p className="text-[10px] text-slate-500 font-mono uppercase tracking-[0.25em] mt-1">On-site validation</p>
              </div>
            </div>

            {/* connection pill */}
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              walletAddress
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}>
              {walletAddress ? <Wifi size={13} /> : <WifiOff size={13} />}
              <span className="hidden sm:inline">{walletAddress ? netLabel : "Offline"}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            </div>
          </div>

          {walletAddress ? (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
              <User size={14} className="text-slate-500" />
              <span className="text-xs text-slate-400">Signed in as</span>
              <span className="ml-auto font-mono text-xs text-slate-200">{short(walletAddress)}</span>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white font-bold text-sm shadow-lg shadow-indigo-900/40 transition-all active:scale-[0.99]"
            >
              <LogIn size={17} /> Connect staff wallet
            </button>
          )}
        </header>

        <main className="w-full max-w-lg space-y-6">
          {/* ── Scanner card ── */}
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 sm:p-6 shadow-2xl shadow-black/40">
            <button
              onClick={() => setIsScanning((s) => !s)}
              className={`w-full py-4 rounded-2xl font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-2.5 border ${
                isScanning
                  ? "bg-red-500/10 text-red-300 border-red-500/30 hover:bg-red-500/20"
                  : "bg-indigo-500/10 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/20"
              }`}
            >
              <Camera size={19} /> {isScanning ? "Stop camera" : "Scan QR with camera"}
            </button>

            <AnimatePresence>
              {isScanning && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: "auto", marginTop: 20 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className="relative rounded-2xl overflow-hidden border border-indigo-500/30"
                >
                  <Scanner
                    onScan={(result) => {
                      if (result && result.length > 0 && result[0].rawValue) {
                        try {
                          const data = JSON.parse(result[0].rawValue);
                          if (data.tokenId) {
                            setIsScanning(false);
                            setTokenId(data.tokenId);
                            handleScan(null, data.tokenId);
                          }
                        } catch (err) {
                          console.error("Invalid QR code:", err);
                        }
                      }
                    }}
                    onError={(error) => console.log(error?.message)}
                    formats={['qr_code']}
                  />
                  {/* scan frame overlay */}
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-6 top-6 w-8 h-8 border-l-2 border-t-2 border-indigo-400 rounded-tl-lg" />
                    <div className="absolute right-6 top-6 w-8 h-8 border-r-2 border-t-2 border-indigo-400 rounded-tr-lg" />
                    <div className="absolute left-6 bottom-6 w-8 h-8 border-l-2 border-b-2 border-indigo-400 rounded-bl-lg" />
                    <div className="absolute right-6 bottom-6 w-8 h-8 border-r-2 border-b-2 border-indigo-400 rounded-br-lg" />
                    <motion.div
                      className="absolute left-6 right-6 h-0.5 bg-gradient-to-r from-transparent via-indigo-400 to-transparent shadow-[0_0_12px_2px_rgba(129,140,248,0.6)]"
                      initial={{ top: "12%" }}
                      animate={{ top: ["12%", "88%", "12%"] }}
                      transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* divider */}
            <div className="flex items-center gap-3 my-5">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">or enter ID</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <form onSubmit={handleScan} className="space-y-4">
              <div className="relative">
                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={20} />
                <input
                  type="number"
                  value={tokenId}
                  onChange={(e) => setTokenId(e.target.value)}
                  placeholder="Token ID"
                  className="w-full bg-[#0b0f1c] border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-xl font-bold text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all placeholder-slate-700 tabular-nums"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !walletAddress}
                className="w-full py-4 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl font-bold text-base shadow-lg shadow-indigo-900/40 transition-all flex items-center justify-center gap-2.5 active:scale-[0.99]"
              >
                {loading ? <RefreshCw className="animate-spin" size={20} /> : <Search size={20} />}
                {loading ? "Verifying…" : "Validate entry"}
              </button>
            </form>
          </section>

          {/* ── Validation result ── */}
          <AnimatePresence mode="wait">
            {scanStatus !== "IDLE" && (
              <motion.section
                key={scanStatus}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.98 }}
                className={`relative overflow-hidden p-8 rounded-3xl border text-center shadow-2xl ${
                  scanStatus === "VALID" ? "bg-emerald-500/[0.07] border-emerald-500/40" :
                  scanStatus === "CONSUMED" ? "bg-red-500/[0.07] border-red-500/40" :
                  scanStatus === "EVENT_BLOCKED" ? "bg-amber-500/[0.07] border-amber-500/40" :
                  "bg-slate-500/[0.06] border-slate-600/40"
                }`}
              >
                {scanStatus === "VALID" && (
                  <div className="space-y-6">
                    <div className="inline-flex p-5 rounded-full bg-emerald-500 text-white shadow-[0_0_40px_rgba(16,185,129,0.5)]">
                      <CheckCircle2 size={56} />
                    </div>
                    <div>
                      <h2 className="text-3xl font-black text-emerald-300 tracking-tight">Entry permitted</h2>
                      <p className="text-emerald-200/50 text-sm mt-1">Valid ticket · not yet used.</p>
                    </div>
                    <div className="rounded-2xl bg-black/30 border border-emerald-500/20 p-5 text-left space-y-3">
                      <div className="flex items-center gap-3 text-sm font-semibold text-white"><TicketIcon size={17} className="text-emerald-400 shrink-0" /> {ticketDetails?.eventName}</div>
                      <div className="flex items-center gap-3 text-xs font-mono text-emerald-200/50"><User size={15} className="text-emerald-400 shrink-0" /> {short(ticketDetails?.owner)}</div>
                      <div className="flex items-center gap-3 text-xs font-mono text-emerald-200/50"><Hash size={15} className="text-emerald-400 shrink-0" /> Token #{ticketDetails?.id}</div>
                    </div>
                    <button
                      onClick={handleUseTicket}
                      className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white rounded-2xl font-black text-lg shadow-lg shadow-emerald-900/40 active:scale-[0.99] transition-all flex items-center justify-center gap-2.5"
                    >
                      <DoorOpen size={22} /> Admit & void ticket
                    </button>
                  </div>
                )}

                {scanStatus === "CONSUMED" && (
                  <div className="space-y-6">
                    <div className="inline-flex p-5 rounded-full bg-red-500 text-white shadow-[0_0_40px_rgba(239,68,68,0.5)]">
                      <XCircle size={56} />
                    </div>
                    <div>
                      <h2 className="text-3xl font-black text-red-300 tracking-tight">Access denied</h2>
                      <p className="text-red-200/50 text-sm mt-1">This ticket was already used at check-in.</p>
                    </div>
                    {ticketDetails && (
                      <div className="rounded-2xl bg-black/30 border border-red-500/20 p-5 text-left">
                        <div className="text-[10px] text-red-400 font-bold uppercase tracking-widest mb-1.5">Already scanned</div>
                        <div className="text-sm font-semibold text-white">{ticketDetails.eventName}</div>
                        <div className="text-xs font-mono text-red-200/40 mt-1">Token #{ticketDetails.id}</div>
                      </div>
                    )}
                  </div>
                )}

                {scanStatus === "EVENT_BLOCKED" && (
                  <div className="space-y-6">
                    <div className="inline-flex p-5 rounded-full bg-amber-500 text-white shadow-[0_0_40px_rgba(245,158,11,0.5)]">
                      <XCircle size={56} />
                    </div>
                    <div>
                      <h2 className="text-3xl font-black text-amber-300 tracking-tight">Entry denied</h2>
                      <p className="text-amber-200/60 text-sm mt-1">
                        {eventStatus === EVENT_STATUS.CANCELED
                          ? "This event was canceled by the organizer."
                          : "This event has already finished."}
                      </p>
                    </div>
                    {ticketDetails && (
                      <div className="rounded-2xl bg-black/30 border border-amber-500/20 p-5 text-left">
                        <div className="text-[10px] text-amber-400 font-bold uppercase tracking-widest mb-1.5">Blocked event</div>
                        <div className="text-sm font-semibold text-white">{ticketDetails.eventName}</div>
                        <div className="text-xs font-mono text-amber-200/40 mt-1">Token #{ticketDetails.id}</div>
                      </div>
                    )}
                  </div>
                )}

                {scanStatus === "INVALID" && (
                  <div className="space-y-4 py-4">
                    <div className="inline-flex p-5 rounded-full bg-slate-700/60 text-slate-300">
                      <ShieldCheck size={48} />
                    </div>
                    <h2 className="text-2xl font-black text-slate-300 tracking-tight">Invalid token</h2>
                    <p className="text-slate-500 text-sm max-w-xs mx-auto">No ticket with this ID exists on the current ledger. Double-check the QR or ID.</p>
                  </div>
                )}

                {/* scan next */}
                <button
                  onClick={resetScan}
                  className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  <RotateCcw size={14} /> Scan next ticket
                </button>
              </motion.section>
            )}
          </AnimatePresence>

          {/* ── Session stats ── */}
          <section className="grid grid-cols-3 gap-3">
            <StatCell icon={<Activity size={16} />} value={stats.scanned} label="Scanned" tone="text-slate-200" />
            <StatCell icon={<CheckCircle2 size={16} />} value={stats.admitted} label="Admitted" tone="text-emerald-400" />
            <StatCell icon={<XCircle size={16} />} value={stats.denied} label="Denied" tone="text-red-400" />
          </section>

          <p className="text-center text-[11px] text-slate-600 pb-4">
            Verification is live &amp; online-only — each scan reads current on-chain state.
          </p>
        </main>
      </div>
    </div>
  );
};

const StatCell = ({ icon, value, label, tone }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
    <div className={`inline-flex mb-1.5 ${tone}`}>{icon}</div>
    <div className={`text-2xl font-black tabular-nums ${tone}`}>{value}</div>
    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest mt-0.5">{label}</div>
  </div>
);

export default GatekeeperTerminal;
