import React, { useState } from "react";
import { ethers } from "ethers";
import { 
  CheckCircle2, XCircle, Search, ShieldCheck, RefreshCw,
  Smartphone, Camera, User, Ticket as TicketIcon
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Scanner } from '@yudiel/react-qr-scanner';
import { CONTRACT_ADDRESS, CONTRACT_ABI, getContractAddress } from "./constants";
import { fetchEventStatusByName, isSaleBlocked, EVENT_STATUS } from "./eventStatus";

const GatekeeperTerminal = ({ walletAddress, wallet, connectWallet }) => {
  const [tokenId, setTokenId] = useState("");
  const [ticketDetails, setTicketDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState("IDLE"); // IDLE, VALID, INVALID, CONSUMED, EVENT_BLOCKED
  const [eventStatus, setEventStatus] = useState(null);  // canceled | finished when EVENT_BLOCKED
  const [isScanning, setIsScanning] = useState(false);

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
      } else if (details.isUsed) {
        setScanStatus("CONSUMED");
      } else {
        setScanStatus("VALID");
      }
    } catch (error) {
      console.error("Scan failed:", error);
      setScanStatus("INVALID");
      setTicketDetails(null);
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
      alert("Entry recorded! Ticket voided.");
    } catch (error) {
      console.error("Use ticket failed:", error);
      alert(error.reason || error.message || "Transaction failed");
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-200 font-sans flex flex-col items-center p-6 sm:p-10">
      
      <header className="w-full max-w-lg mb-12 text-center">
        <div className="inline-flex p-3 bg-indigo-600/10 rounded-2xl border border-indigo-500/20 mb-4 text-indigo-400">
          <ShieldCheck size={32} />
        </div>
        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Gate Verifier Pro</h1>
        <p className="text-xs text-slate-500 font-mono mt-1 uppercase tracking-widest">On-Site Validation Terminal v4.2</p>
        {!walletAddress && (
          <button onClick={connectWallet} className="mt-6 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl transition-all">
            Connect Wallet
          </button>
        )}
      </header>

      <main className="w-full max-w-lg space-y-8">
        
        {/* Scanner Field */}
        <section className="bg-[#1e2538] p-8 rounded-[32px] border border-slate-800 shadow-2xl">
          
          <div className="mb-6 flex justify-center">
            <button
              onClick={() => setIsScanning(!isScanning)}
              className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 border-2 ${
                isScanning ? 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:bg-indigo-500/20'
              }`}
            >
              <Camera size={20} /> {isScanning ? "Stop Camera" : "Start Camera Scanner"}
            </button>
          </div>

          {isScanning && (
            <div className="mb-8 rounded-2xl overflow-hidden border-2 border-indigo-500/30">
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
            </div>
          )}

          <form onSubmit={handleScan} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Manual Ledger Entry</label>
              <div className="relative">
                <input 
                  type="number" 
                  value={tokenId} 
                  onChange={(e) => setTokenId(e.target.value)} 
                  placeholder="Type Token ID..." 
                  className="w-full bg-[#0b0f19] border-2 border-slate-800 rounded-2xl py-5 px-6 text-2xl font-black text-white focus:border-indigo-500 outline-none transition-all placeholder-slate-800"
                />
              </div>
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-lg shadow-xl shadow-indigo-500/20 transition-all flex items-center justify-center gap-3 active:scale-95"
            >
              {loading ? <RefreshCw className="animate-spin" /> : <Search size={24} />}
              {loading ? "SEARCHING LEDGER..." : "VALIDATE ENTRY"}
            </button>
          </form>
        </section>

        {/* Validation Result */}
        <AnimatePresence mode="wait">
          {scanStatus !== "IDLE" && (
            <motion.section 
              initial={{ opacity: 0, y: 20 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: -20 }}
              className={`p-10 rounded-[40px] border-4 text-center shadow-2xl ${
                scanStatus === "VALID" ? "bg-emerald-950/40 border-emerald-500/50" :
                scanStatus === "CONSUMED" ? "bg-red-950/40 border-red-500/50" :
                scanStatus === "EVENT_BLOCKED" ? "bg-amber-950/40 border-amber-500/50" :
                "bg-slate-900 border-slate-700"
              }`}
            >
              {scanStatus === "VALID" && (
                <div className="space-y-8">
                  <div className="inline-flex p-6 bg-emerald-500 rounded-full text-white shadow-lg shadow-emerald-500/40">
                    <CheckCircle2 size={64} />
                  </div>
                  <div>
                    <h2 className="text-4xl font-black text-emerald-400 uppercase tracking-tighter mb-2">ENTRY PERMITTED</h2>
                    <p className="text-emerald-200/60 font-medium">This asset is valid and unconsumed.</p>
                  </div>
                  
                  <div className="bg-black/40 rounded-3xl p-6 text-left space-y-3 border border-emerald-500/20">
                    <div className="flex items-center gap-3 text-sm font-bold text-white"><TicketIcon size={18} className="text-emerald-500" /> {ticketDetails?.eventName}</div>
                    <div className="flex items-center gap-3 text-xs font-mono text-emerald-200/60"><User size={16} className="text-emerald-500" /> {ticketDetails?.owner.substring(0, 16)}...</div>
                  </div>

                  <button 
                    onClick={handleUseTicket}
                    className="w-full py-6 bg-white text-emerald-900 rounded-2xl font-black text-xl shadow-2xl active:scale-95 transition-all"
                  >
                    CONFIRM & VOID TICKET
                  </button>
                </div>
              )}

              {scanStatus === "CONSUMED" && (
                <div className="space-y-8 py-4">
                  <div className="inline-flex p-6 bg-red-500 rounded-full text-white shadow-lg shadow-red-500/40">
                    <XCircle size={64} />
                  </div>
                  <div>
                    <h2 className="text-4xl font-black text-red-400 uppercase tracking-tighter mb-2">ACCESS DENIED</h2>
                    <p className="text-red-200/60 font-medium italic">Token already consumed at check-in.</p>
                  </div>
                  {ticketDetails && (
                    <div className="bg-black/40 rounded-3xl p-6 text-left border border-red-500/20">
                      <div className="text-[10px] text-red-400 font-black uppercase tracking-widest mb-1">Incident Report</div>
                      <div className="text-sm font-bold text-white">{ticketDetails.eventName}</div>
                      <div className="text-xs font-mono text-red-200/40 mt-1">ID: #{ticketDetails.id}</div>
                    </div>
                  )}
                </div>
              )}

              {scanStatus === "INVALID" && (
                <div className="space-y-6 py-10">
                  <div className="text-slate-600 mb-4"><ShieldCheck size={80} className="mx-auto opacity-20" /></div>
                  <h2 className="text-3xl font-black text-slate-400 uppercase tracking-tighter">INVALID TOKEN</h2>
                  <p className="text-slate-500 text-sm max-w-xs mx-auto">No record of this Token ID found on the current blockchain ledger.</p>
                </div>
              )}

              {scanStatus === "EVENT_BLOCKED" && (
                <div className="space-y-6 py-4">
                  <div className="inline-flex p-6 bg-amber-500 rounded-full text-white shadow-lg shadow-amber-500/40">
                    <XCircle size={64} />
                  </div>
                  <div>
                    <h2 className="text-4xl font-black text-amber-400 uppercase tracking-tighter mb-2">ENTRY DENIED</h2>
                    <p className="text-amber-200/70 font-medium italic">
                      {eventStatus === EVENT_STATUS.CANCELED
                        ? "This event has been canceled by the organizer."
                        : "This event has already finished."}
                    </p>
                  </div>
                  {ticketDetails && (
                    <div className="bg-black/40 rounded-3xl p-6 text-left border border-amber-500/20">
                      <div className="text-[10px] text-amber-400 font-black uppercase tracking-widest mb-1">Blocked event</div>
                      <div className="text-sm font-bold text-white">{ticketDetails.eventName}</div>
                      <div className="text-xs font-mono text-amber-200/40 mt-1">ID: #{ticketDetails.id}</div>
                    </div>
                  )}
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {/* Footer Stats */}
        <footer className="flex justify-between px-4">
          <div className="text-center">
            <div className="text-2xl font-black text-white">420</div>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Total Entry</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-black text-indigo-500">69</div>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Staff On-Call</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-black text-emerald-500">98%</div>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Scan Rate</div>
          </div>
        </footer>

      </main>
    </div>
  );
};

export default GatekeeperTerminal;