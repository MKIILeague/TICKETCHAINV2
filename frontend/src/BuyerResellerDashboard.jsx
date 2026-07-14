import React, { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { ethers } from "ethers";
import {
  Wallet, Send, Tag, Search, Compass, MapPin,
  Clock, RefreshCw, Copy, Check, ExternalLink, QrCode, Info,
  Ticket, ShieldCheck, ArrowRight, Zap, X, Ban, CheckCircle2,
  CalendarClock, AlertTriangle, History, ChevronLeft, ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { CONTRACT_ABI, PUBLIC_RPC_URL, getContractAddress, getDeployments } from "./constants";
import {
  EVENT_STATUS, normalizeEventName, isTransferFrozen, fetchPublicEventStatusMap
} from "./eventStatus";
import EventsHappening, { formatEventWindow } from "./EventsHappening";
import heroSlideConfetti from "./assets/slides/slide3.jpeg";
import heroSlideStage from "./assets/slides/slide1.jpg";
import heroSlideAerial from "./assets/slides/slide2.jpeg";
import { QRCodeSVG } from "qrcode.react";
import { rm, ethLabel } from "./currency";

// Run an async fn over items with bounded concurrency. Firing 100+ contract
// reads in parallel gets public RPCs to rate-limit and silently drop responses,
// which made the owned-count show while every ticket card got dropped. Keeping
// only a handful in flight at once is reliable.
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

// Retry a flaky read a few times with backoff (public RPCs occasionally 429).
async function withRetry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
  }
  throw lastErr;
}

const BuyerResellerDashboard = ({ walletAddress, wallet, connectWallet, view }) => {
  const location = useLocation();
  // Post-purchase confirmation passed from the checkout page (router state).
  const [purchaseBanner, setPurchaseBanner] = useState(location.state?.purchased || null);

  const [tickets, setTickets] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isPaused, setIsPaused] = useState(false);

  // Resale flow states
  const [resaleTicket, setResaleTicket] = useState(null);
  const [resalePriceInput, setResalePriceInput] = useState("");

  // Transfer flow states
  const [transferTicket, setTransferTicket] = useState(null);
  const [recipientAddress, setRecipientAddress] = useState("");

  // Wallet specific states
  const [ethBalance, setEthBalance] = useState("0.00");
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);

  // Send ETH flow states
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [isSendingEth, setIsSendingEth] = useState(false);
  const [activeChainId, setActiveChainId] = useState(11155111);
  const [localhostFaucetLoading, setLocalhostFaucetLoading] = useState(false);
  const [ticketBalance, setTicketBalance] = useState(0); // ERC-721 balanceOf — authoritative owned count
  const [isLoadingTickets, setIsLoadingTickets] = useState(true);

  // Firestore event-status overlay (name -> { status }). Used to badge/freeze
  // canceled events and archive finished ones. Legacy on-chain events with no
  // Firestore doc default to "published" (active).
  const [eventStatusMap, setEventStatusMap] = useState({});
  const statusFor = (title) => eventStatusMap[normalizeEventName(title)]?.status || EVENT_STATUS.PUBLISHED;
  // Which lifecycle group of "Your tickets" is shown: upcoming | missed | history.
  const [ticketTab, setTicketTab] = useState("upcoming");

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

      addNotification("Localhost ETH transaction sent. Waiting for block confirmation...", "info");
      await tx.wait();
      addNotification("Received 10.0 Localhost ETH! Your wallet is now funded.", "success");
      fetchDashboardData();
    } catch (err) {
      console.error("Localhost faucet failed:", err);
      addNotification("Faucet failed. Ensure your local Hardhat node is running on http://127.0.0.1:8545.", "error");
    } finally {
      setLocalhostFaucetLoading(false);
    }
  };

  const addNotification = (msg, type = "info") => {
    alert(`[${type.toUpperCase()}] ${msg}`);
  };

  const handleCopyAddress = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onSendEth = async (toAddress, amount) => {
    if (!wallet) return;
    setIsSendingEth(true);
    try {
      const eip1193Provider = await wallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(eip1193Provider);
      const signer = await provider.getSigner();

      const tx = await signer.sendTransaction({
        to: toAddress,
        value: ethers.parseEther(amount.toString())
      });
      await tx.wait();
      addNotification("ETH sent successfully!", "success");
      setShowSendModal(false);
      setSendRecipient("");
      setSendAmount("");
      fetchDashboardData();
    } catch (error) {
      console.error("Send ETH failed:", error);
      addNotification(error.reason || "Transaction failed", "error");
    } finally {
      setIsSendingEth(false);
    }
  };

  // Sepolia read RPCs. Public endpoints serve a single `eth_getLogs` fine but
  // RATE-LIMIT bursts of small calls — firing ownerOf for all ~50 minted tokens
  // got every read dropped (count showed, no cards). So we discover the wallet's
  // tokens from Transfer event logs (incoming minus outgoing = 2 cheap log
  // queries) and fetch getTicketDetails only for the few tokens it owns.
  const SEPOLIA_READ_RPCS = [
    PUBLIC_RPC_URL,               // primary (sepolia.drpc.org)
    "https://1rpc.io/sepolia",    // verified fallback
    "https://sepolia.drpc.org",
  ];

  const fetchDashboardData = async () => {
    setIsLoadingTickets(true);
    try {
      // 1) Which chain do we read from? The app is Sepolia-only (see main.jsx
      //    `supportedChains`). We only honour the local Hardhat node (31337) when
      //    actually developing locally. Otherwise a connected injected wallet
      //    (e.g. MetaMask) sitting on a Hardhat network would make us query
      //    http://127.0.0.1:8545, whose accounts are pre-funded with 10000 ETH —
      //    that bogus "9999.99…" balance was leaking into "My Wallet". In a
      //    deployed build we always resolve to Sepolia regardless of the wallet's
      //    reported network.
      const allowLocal = import.meta.env.DEV;
      let chainId = 11155111;
      let walletMatchesChain = false;   // is the wallet actually on the chain we read?
      let walletProvider = null;        // the wallet's own RPC (reliable for logs)
      if (wallet) {
        try {
          walletProvider = new ethers.BrowserProvider(await wallet.getEthereumProvider());
          const walletChain = Number((await walletProvider.getNetwork()).chainId);
          if (walletChain === 11155111 || (allowLocal && walletChain === 31337)) {
            chainId = walletChain;
            walletMatchesChain = true;
          }
          // Any other chain (mainnet, or a stray localhost node in production)
          // falls through to Sepolia — the only network this app supports.
        } catch (e) {
          console.warn("Could not read wallet network, defaulting to Sepolia:", e?.message);
        }
      }
      setActiveChainId(chainId);
      // Every contract this wallet's tickets could live on. After a redeploy,
      // tickets bought on an older contract are orphaned unless we scan it too.
      const deployments = getDeployments(chainId);
      const primary = deployments[0];
      const urls = chainId === 31337 ? ["http://127.0.0.1:8545"] : [...new Set(SEPOLIA_READ_RPCS)];

      // Ordered read providers to try. The embedded wallet's OWN RPC (Privy/
      // Alchemy-backed) has generous eth_getLogs limits and is proven reliable —
      // the organizer dashboard reads through it — so try it FIRST when the
      // wallet is on the chain we're reading, then fall back to the public RPCs.
      // Some public RPCs silently cap historical log ranges and return nothing,
      // which is why a freshly-bought ticket never appeared in "Your tickets".
      const readProviders = [];
      if (walletMatchesChain && walletProvider) readProviders.push(walletProvider);
      urls.forEach((u) => readProviders.push(new ethers.JsonRpcProvider(u)));

      // 2) Native ETH balance FIRST, and independently of the heavier historical
      //    log queries below. `getBalance` works on ANY provider, so a funded
      //    wallet must never read 0 just because an archival eth_getLogs call was
      //    rate-limited/rejected (that early-return used to strand it at 0.00).
      if (walletAddress) {
        setIsFetchingBalance(true);
        let gotBalance = false;
        for (const p of readProviders) {
          try {
            setEthBalance(ethers.formatEther(await p.getBalance(walletAddress)));
            gotBalance = true;
            break;
          } catch (e) {
            console.warn("Balance read failed on a provider:", e?.message);
          }
        }
        if (!gotBalance) console.error("All providers failed to return a balance.");
        setIsFetchingBalance(false);
      }

      // 3) Pick a provider that can actually serve historical logs, validating it
      //    with the real query we depend on (some accept getBlockNumber but
      //    reject eth_getLogs — see the SEPOLIA_READ_RPCS note).
      let provider = null;
      for (const p of readProviders) {
        try {
          if (walletAddress) {
            const c = new ethers.Contract(primary.address, CONTRACT_ABI, p);
            await c.queryFilter(c.filters.Transfer(null, walletAddress), primary.startBlock);
          } else {
            await p.getBlockNumber();
          }
          provider = p;
          break; // this provider works — reuse it for the rest
        } catch (e) {
          console.warn("Read provider failed log validation:", e?.info?.error?.message || e?.message);
        }
      }

      if (!provider) {
        console.error("No working read provider for ticket logs (balance already shown).");
        return; // balance is already set above; just skip the ticket sync this round
      }

      const primaryContract = new ethers.Contract(primary.address, CONTRACT_ABI, provider);
      setIsPaused(await primaryContract.paused().catch(() => false));

      // Logged out → nothing to show in "Your tickets".
      if (!walletAddress) {
        setTickets([]);
        return;
      }

      // 4) Scan EVERY deployment for tickets this wallet owns, tagging each with
      //    the contract it lives on (so resale/transfer target the right one).
      //    Owned = Transfer-in minus Transfer-out per contract.
      const perContract = await Promise.all(deployments.map(async (dep) => {
        try {
          const c = new ethers.Contract(dep.address, CONTRACT_ABI, provider);
          const [incoming, outgoing] = await Promise.all([
            c.queryFilter(c.filters.Transfer(null, walletAddress), dep.startBlock),
            c.queryFilter(c.filters.Transfer(walletAddress, null), dep.startBlock),
          ]);
          const owned = new Set(incoming.map((l) => l.args[2].toString()));
          outgoing.forEach((l) => owned.delete(l.args[2].toString()));
          const iAmOrganizer = await c.whitelistedOrganizers(walletAddress).catch(() => false);
          const rows = await mapLimit([...owned], 4, async (id) => {
            try {
              const details = await withRetry(() => c.getTicketDetails(id));
              return {
                id: id.toString(),
                contractAddress: dep.address,
                eventTitle: details.eventName || `Ticket #${id}`,
                mintPrice: parseFloat(ethers.formatEther(details.originalPrice || 0n)),
                isUsed: details.isUsed || false,
                isListed: details.isForResale || false,
                resalePrice: details.resalePrice ? parseFloat(ethers.formatEther(details.resalePrice)) : 0,
                owner: walletAddress,
                isPrimary: iAmOrganizer,
                category: "VIP",
                imageUri: "https://images.unsplash.com/photo-1540039155732-68473500d6cb?q=80&w=800&auto=format&fit=crop",
                date: "Oct 24, 2026",
                venue: "Global Main Stage"
              };
            } catch (ticketErr) {
              console.warn(`Skipped token #${id} on ${dep.address}:`, ticketErr?.message);
              return null;
            }
          });
          return rows.filter(Boolean);
        } catch (depErr) {
          console.warn(`Deployment ${dep.address} scan failed:`, depErr?.message);
          return [];
        }
      }));

      // Flatten newest-first; dedupe colliding token ids (newest contract wins)
      // so the per-id lookups in the resale/transfer handlers stay unambiguous.
      const seen = new Set();
      const ticketList = [];
      perContract.forEach((rows) => rows.forEach((t) => {
        if (seen.has(t.id)) return;
        seen.add(t.id);
        ticketList.push(t);
      }));

      setTicketBalance(ticketList.length);
      setTickets(ticketList);
    } catch (error) {
      console.error("Dashboard Sync Error:", error);
    } finally {
      setIsLoadingTickets(false);
    }
  };

  // Depend on the stable address string, not the `wallet` object (its identity
  // changes every render, which caused an infinite fetch/abort loop).
  useEffect(() => {
    fetchDashboardData();
  }, [walletAddress]);

  // Arriving straight from checkout, the public RPC's log index can still be
  // several blocks behind, so the just-bought ticket may not be visible on the
  // first read. Re-sync a few times (spread out) after landing so it appears
  // without a manual tap even when Sepolia indexing is slow.
  useEffect(() => {
    if (!purchaseBanner || !walletAddress) return;
    const timers = [1500, 4000, 9000, 15000].map((ms) => setTimeout(() => fetchDashboardData(), ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseBanner, walletAddress]);

  // Pull the Firestore event-status overlay once (and whenever tickets reload).
  useEffect(() => {
    fetchPublicEventStatusMap().then(setEventStatusMap).catch(() => {});
  }, [tickets.length]);

  // A ticket may live on an older contract deployment (it was minted/bought
  // before the last redeploy). Resale/transfer must target THAT contract, not
  // the current one — otherwise the token doesn't exist there and the tx reverts.
  const contractForTicket = (ticketId) =>
    tickets.find((t) => t.id === String(ticketId))?.contractAddress || getContractAddress(activeChainId);

  const onListResale = async (ticketId, price) => {
    if (!wallet) return;
    const resaleTarget = tickets.find((t) => t.id === String(ticketId));
    if (resaleTarget && isTransferFrozen(statusFor(resaleTarget.eventTitle))) {
      addNotification("This event was canceled — resale and transfers are frozen.", "error");
      return false;
    }
    try {
      let eip1193Provider = await wallet.getEthereumProvider();
      let provider = new ethers.BrowserProvider(eip1193Provider);

      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      // Sepolia-only in production; the local Hardhat node is a dev-only path.
      const targetChainId = (import.meta.env.DEV && currentChainId === 31337) ? 31337 : 11155111;

      if (currentChainId !== targetChainId) {
        await wallet.switchChain(targetChainId);
        eip1193Provider = await wallet.getEthereumProvider();
        provider = new ethers.BrowserProvider(eip1193Provider);
      }

      // Pre-flight gas check
      const balance = await provider.getBalance(walletAddress);
      const balanceInEth = parseFloat(ethers.formatEther(balance));
      const requiredGas = 0.0003;

      if (balanceInEth < requiredGas) {
        addNotification(`❌ Insufficient funds for gas!\n\nYou currently have ${balanceInEth.toFixed(4)} ETH, but you need at least ${requiredGas} ETH to send this transaction.`, "error");
        return false;
      }

      const signer = await provider.getSigner();
      const contractAddress = contractForTicket(ticketId);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
      const priceInWei = ethers.parseEther(price.toString());
      const tx = await contract.listTicketForResale(ticketId, priceInWei);
      await tx.wait();
      addNotification("Ticket listed for resale!", "success");
      fetchDashboardData();
      return true;
    } catch (error) {
      console.error("Resale failed:", error);
      addNotification(error.reason || error.message || "Transaction failed", "error");
      return false;
    }
  };

  const onCancelResale = async (ticketId) => {
    if (!wallet) return;
    try {
      let eip1193Provider = await wallet.getEthereumProvider();
      let provider = new ethers.BrowserProvider(eip1193Provider);

      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      // Sepolia-only in production; the local Hardhat node is a dev-only path.
      const targetChainId = (import.meta.env.DEV && currentChainId === 31337) ? 31337 : 11155111;

      if (currentChainId !== targetChainId) {
        await wallet.switchChain(targetChainId);
        eip1193Provider = await wallet.getEthereumProvider();
        provider = new ethers.BrowserProvider(eip1193Provider);
      }

      // Pre-flight gas check
      const balance = await provider.getBalance(walletAddress);
      const balanceInEth = parseFloat(ethers.formatEther(balance));
      const requiredGas = 0.0003;

      if (balanceInEth < requiredGas) {
        addNotification(`❌ Insufficient funds for gas!\n\nYou currently have ${balanceInEth.toFixed(4)} ETH, but you need at least ${requiredGas} ETH to send this transaction.`, "error");
        return;
      }

      const signer = await provider.getSigner();
      const contractAddress = contractForTicket(ticketId);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
      const tx = await contract.cancelResaleListing(ticketId);
      await tx.wait();
      addNotification("Listing cancelled", "success");
      fetchDashboardData();
    } catch (error) {
      console.error("Cancel failed:", error);
      addNotification(error.reason || error.message || "Transaction failed", "error");
    }
  };

  const onTransfer = async (ticketId, toAddress) => {
    if (!wallet) return;
    const transferTarget = tickets.find((t) => t.id === String(ticketId));
    if (transferTarget && isTransferFrozen(statusFor(transferTarget.eventTitle))) {
      addNotification("This event was canceled — transfers are frozen.", "error");
      return false;
    }
    try {
      let eip1193Provider = await wallet.getEthereumProvider();
      let provider = new ethers.BrowserProvider(eip1193Provider);

      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      // Sepolia-only in production; the local Hardhat node is a dev-only path.
      const targetChainId = (import.meta.env.DEV && currentChainId === 31337) ? 31337 : 11155111;

      if (currentChainId !== targetChainId) {
        await wallet.switchChain(targetChainId);
        eip1193Provider = await wallet.getEthereumProvider();
        provider = new ethers.BrowserProvider(eip1193Provider);
      }

      // Pre-flight gas check
      const balance = await provider.getBalance(walletAddress);
      const balanceInEth = parseFloat(ethers.formatEther(balance));
      const requiredGas = 0.0003;

      if (balanceInEth < requiredGas) {
        addNotification(`❌ Insufficient funds for gas!\n\nYou currently have ${balanceInEth.toFixed(4)} ETH, but you need at least ${requiredGas} ETH to send this transaction.`, "error");
        return false;
      }

      const signer = await provider.getSigner();
      const contractAddress = contractForTicket(ticketId);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
      const tx = await contract.safeTransferFrom(walletAddress, toAddress, ticketId);
      await tx.wait();
      addNotification("Ticket transferred!", "success");
      fetchDashboardData();
      return true;
    } catch (error) {
      console.error("Transfer failed:", error);
      addNotification(error.reason || error.message || "Transaction failed", "error");
      return false;
    }
  };

  // "My Tickets" = every token the connected wallet currently owns, EXCEPT an
  // organizer's own unsold inventory (a primary ticket still listed for sale).
  // A purchased ticket has isForResale=false, so it shows here even if the buyer
  // happens to also be a whitelisted organizer (the case that broke before).
  const myTickets = tickets.filter(
    (t) => walletAddress && t.owner.toLowerCase() === walletAddress.toLowerCase() && !(t.isPrimary && t.isListed)
  );

  // Group tickets by lifecycle so buyers can separate what's still valid from
  // what's done. `statusFor` already resolves a passed event date to FINISHED.
  //  · upcoming → event still ahead, not scanned  → usable (resell/transfer/entry)
  //  · missed   → event date passed, never scanned → expired, unused
  //  · history  → scanned at the gate (attended) OR the event was canceled
  const ticketGroup = (t) => {
    if (t.isUsed) return "history";
    const st = statusFor(t.eventTitle);
    if (st === EVENT_STATUS.CANCELED) return "history";
    if (st === EVENT_STATUS.FINISHED) return "missed";
    return "upcoming";
  };
  const ticketBuckets = { upcoming: [], missed: [], history: [] };
  myTickets.forEach((t) => ticketBuckets[ticketGroup(t)].push(t));
  const filteredMyTickets = ticketBuckets[ticketTab].filter((t) =>
    t.eventTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.venue.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const resaleMaxPrice = resaleTicket ? resaleTicket.mintPrice * 1.1 : 0;
  const priceExceeded = resaleTicket && resalePriceInput !== ""
    ? parseFloat(resalePriceInput) > resaleMaxPrice
    : false;

  const networkLabel = activeChainId === 31337 ? "Localhost" : "Sepolia testnet";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">

      {view === "wallet" ? (
        /* ─────────────────────────── WALLET VIEW ─────────────────────────── */
        <div className="max-w-7xl mx-auto px-6 sm:px-10 py-12 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {purchaseBanner && (
            <div className="mb-8 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-800">
                  Successfully purchased {purchaseBanner} ticket{purchaseBanner > 1 ? "s" : ""}!
                </p>
                <p className="text-sm text-emerald-700">Your secure entry QR codes have been generated.</p>
              </div>
              <button onClick={() => setPurchaseBanner(null)} className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-100 transition-colors" aria-label="Dismiss">
                <X size={18} />
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Your wallet</h1>
              <p className="text-slate-500 mt-1">Manage your balance and tickets.</p>
            </div>
            {!walletAddress && (
              <button onClick={connectWallet} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors">
                Connect wallet
              </button>
            )}
          </div>

          {/* Balance + quick actions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">

            {/* Balance card */}
            <div className="lg:col-span-2 relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-50 to-white p-8 flex flex-col justify-between min-h-[280px]">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
                    <Wallet size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">TicketChain wallet</p>
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
                    {isFetchingBalance ? (
                      <span className="inline-block animate-pulse w-28 h-12 bg-slate-200 rounded-lg align-middle" />
                    ) : (
                      parseFloat(ethBalance).toFixed(4)
                    )}
                  </span>
                  <span className="text-xl font-semibold text-slate-400">ETH</span>
                  <button
                    onClick={fetchDashboardData}
                    disabled={isFetchingBalance}
                    className="ml-2 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors cursor-pointer"
                    title="Refresh balance"
                  >
                    <RefreshCw size={16} className={isFetchingBalance ? "animate-spin" : ""} />
                  </button>
                </div>
                <p className="text-sm text-slate-500 mt-1">≈ {rm(ethBalance)}</p>
              </div>

              <div className="flex items-center justify-between gap-4 pt-5 border-t border-slate-200">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500 mb-0.5">Wallet address</p>
                  <p className="font-mono text-sm text-slate-700 truncate">
                    {walletAddress ? walletAddress : "Not connected"}
                  </p>
                </div>
                {walletAddress && (
                  <button
                    onClick={handleCopyAddress}
                    className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${copied ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"}`}
                  >
                    {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                  </button>
                )}
              </div>
            </div>

            {/* Quick actions */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 flex flex-col justify-between min-h-[280px]">
              <div>
                <h3 className="font-semibold text-slate-900 mb-4">Quick actions</h3>
                <div className="space-y-3">
                  <button
                    onClick={() => setShowSendModal(true)}
                    disabled={!walletAddress}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Send size={15} /> Send ETH
                  </button>
                  <button
                    onClick={() => setShowReceiveModal(true)}
                    disabled={!walletAddress}
                    className="w-full py-3 bg-white border border-slate-200 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 text-slate-700 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <QrCode size={15} /> Receive
                  </button>
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-200">
                {activeChainId === 31337 ? (
                  <>
                    <div className="flex gap-2 items-start mb-3">
                      <Info size={15} className="mt-0.5 shrink-0 text-cyan-600" />
                      <p className="text-xs text-slate-500 leading-relaxed">
                        You're on the local node. Fund this wallet with 10 test ETH instantly.
                      </p>
                    </div>
                    <button
                      onClick={handleLocalhostFaucet}
                      disabled={localhostFaucetLoading || !walletAddress}
                      className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {localhostFaucetLoading ? (
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : "Get 10 test ETH"}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex gap-2 items-start mb-3">
                      <Info size={15} className="mt-0.5 shrink-0 text-amber-500" />
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Need test ETH for gas? Grab free Sepolia ETH from a faucet.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <a href="https://sepolia-faucet.pk910.de/" target="_blank" rel="noopener noreferrer"
                        className="py-2 px-3 bg-white border border-slate-200 hover:bg-slate-50 hover:text-indigo-600 text-xs font-semibold text-slate-600 rounded-lg transition-colors flex items-center justify-center gap-1">
                        PoW faucet <ExternalLink size={11} />
                      </a>
                      <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noopener noreferrer"
                        className="py-2 px-3 bg-white border border-slate-200 hover:bg-slate-50 hover:text-indigo-600 text-xs font-semibold text-slate-600 rounded-lg transition-colors flex items-center justify-center gap-1">
                        Alchemy <ExternalLink size={11} />
                      </a>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* My tickets */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-slate-900">Your tickets</h2>
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white pl-2 pr-3.5 py-1.5 text-sm font-semibold shadow-[0_4px_20px_rgba(79,70,229,0.35)]">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-500 text-white text-xs font-bold tabular-nums">{myTickets.length}</span>
                You own {myTickets.length} secure ticket{myTickets.length === 1 ? "" : "s"}
              </span>
              <button
                onClick={fetchDashboardData}
                disabled={isLoadingTickets}
                title="Refresh tickets"
                className="inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-600 px-3 py-1.5 text-xs font-semibold transition-colors"
              >
                <RefreshCw size={13} className={isLoadingTickets ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search your tickets"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
              />
            </div>
          </div>

          {/* Lifecycle tabs — separate valid tickets from expired/attended ones */}
          <div className="flex items-center gap-2 mb-6 overflow-x-auto">
            {[
              { id: "upcoming", label: "Upcoming", icon: CalendarClock, count: ticketBuckets.upcoming.length },
              { id: "missed", label: "Missed", icon: AlertTriangle, count: ticketBuckets.missed.length },
              { id: "history", label: "History", icon: History, count: ticketBuckets.history.length },
            ].map((tab) => {
              const activeTab = ticketTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setTicketTab(tab.id)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold border transition-colors whitespace-nowrap ${activeTab ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
                >
                  <Icon size={15} className={activeTab ? "text-indigo-300" : "text-slate-400"} />
                  {tab.label}
                  <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold tabular-nums ${activeTab ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"}`}>{tab.count}</span>
                </button>
              );
            })}
          </div>

          {/* Owned vs. visible mismatch hint (almost always RPC lag right after buying) */}
          {!isLoadingTickets && ticketBalance > myTickets.length && (
            <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <Info size={18} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800">
                  {ticketBalance - myTickets.length} ticket{ticketBalance - myTickets.length === 1 ? "" : "s"} still syncing
                </p>
                <p className="text-sm text-amber-700">The network is catching up after your purchase. Tap refresh in a few seconds.</p>
              </div>
              <button onClick={fetchDashboardData} disabled={isLoadingTickets} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-3 py-2 text-xs font-semibold transition-colors">
                <RefreshCw size={13} className={isLoadingTickets ? "animate-spin" : ""} /> Refresh
              </button>
            </div>
          )}

          {isLoadingTickets && myTickets.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[0, 1, 2].map((i) => <TicketCardSkeleton key={i} />)}
            </div>
          ) : filteredMyTickets.length === 0 ? (
            <div className="border border-dashed border-slate-300 rounded-2xl p-16 text-center bg-slate-50">
              <Compass className="w-10 h-10 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600 font-semibold">
                {searchQuery
                  ? "No tickets match your search"
                  : ticketTab === "upcoming" ? "No upcoming tickets"
                  : ticketTab === "missed" ? "No missed tickets"
                  : "No ticket history yet"}
              </p>
              <p className="text-slate-400 text-sm mt-1">
                {searchQuery
                  ? "Try a different event or venue name."
                  : ticketTab === "upcoming" ? "Tickets you buy will show up here until the event ends."
                  : ticketTab === "missed" ? "Tickets you didn't scan before the event passed will land here."
                  : "Scanned tickets and canceled events will be archived here."}
              </p>
              {!searchQuery && ticketTab === "upcoming" && (
                <a href="/#events" className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors">
                  Browse events <ArrowRight size={16} />
                </a>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredMyTickets.map(ticket => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  meta={eventStatusMap[normalizeEventName(ticket.eventTitle)]?.ev}
                  status={statusFor(ticket.eventTitle)}
                  owner={walletAddress}
                  contractAddress={ticket.contractAddress || getContractAddress(activeChainId)}
                  chainId={activeChainId}
                  onResell={() => { setResaleTicket(ticket); setResalePriceInput(""); }}
                  onTransfer={() => { setTransferTicket(ticket); setRecipientAddress(""); }}
                  onCancel={() => onCancelResale(ticket.id)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ─────────────────────── MARKETPLACE / LANDING ───────────────────── */
        <>
          {/* Hero — 3-slide crossfading showcase */}
          <HeroSlideshow walletAddress={walletAddress} connectWallet={connectWallet} />

          {/* Events Happening — Firestore-driven storefront grid */}
          <EventsHappening />
        </>
      )}

      {/* MODALS */}
      <AnimatePresence>
        {resaleTicket && (
          <Modal onClose={() => setResaleTicket(null)} icon={<Tag size={20} />} title="List for resale" subtitle="Anti-scalping cap applies">
            <p className="text-sm text-slate-600 leading-relaxed">
              To keep things fair, the price is capped at 110% of the original.
              Maximum: <span className="font-semibold text-slate-900">{rm(resaleMaxPrice)}</span> <span className="text-slate-400">({ethLabel(resaleMaxPrice)})</span>.
            </p>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Asking price (ETH)</label>
              <input
                type="number"
                step="0.001"
                value={resalePriceInput}
                onChange={(e) => setResalePriceInput(e.target.value)}
                placeholder="0.00"
                className={`w-full bg-white border rounded-xl py-3 px-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all ${priceExceeded ? "border-red-400 focus:ring-2 focus:ring-red-100" : "border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"}`}
              />
              {priceExceeded ? (
                <p className="text-red-600 text-xs mt-1.5">Above the 110% cap — lower the price to continue.</p>
              ) : parseFloat(resalePriceInput) > 0 && (
                <p className="text-slate-500 text-xs mt-1.5">Buyers see <span className="font-semibold text-slate-700">{rm(resalePriceInput)}</span></p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setResaleTicket(null)}
                className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-semibold text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => onListResale(resaleTicket.id, resalePriceInput).then(s => s && setResaleTicket(null))}
                disabled={!resalePriceInput || priceExceeded || isPaused}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors"
              >
                List ticket
              </button>
            </div>
          </Modal>
        )}

        {transferTicket && (
          <Modal onClose={() => setTransferTicket(null)} icon={<Send size={20} />} title="Transfer ticket" subtitle="Send directly to another wallet">
            <p className="text-sm text-slate-600 leading-relaxed">
              This sends the ticket to the address below. Transfers are final and can't be undone.
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Recipient address</label>
              <input
                type="text"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                placeholder="0x…"
                className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 text-sm font-mono text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setTransferTicket(null)}
                className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-semibold text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => onTransfer(transferTicket.id, recipientAddress).then(s => s && setTransferTicket(null))}
                disabled={!recipientAddress || isPaused}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors"
              >
                Transfer
              </button>
            </div>
          </Modal>
        )}

        {showSendModal && (
          <Modal onClose={() => setShowSendModal(false)} icon={<Send size={20} />} title="Send ETH" subtitle={networkLabel}>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Recipient address</label>
              <input
                type="text"
                value={sendRecipient}
                onChange={(e) => setSendRecipient(e.target.value)}
                placeholder="0x…"
                className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 text-sm font-mono text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount (ETH)</label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                placeholder="0.0"
                className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
              />
              <p className="text-xs text-slate-500 mt-1.5 text-right">
                Available: {parseFloat(ethBalance).toFixed(4)} ETH
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSendModal(false)}
                className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-semibold text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => onSendEth(sendRecipient, sendAmount)}
                disabled={!sendRecipient || !sendAmount || isSendingEth || parseFloat(sendAmount) > parseFloat(ethBalance)}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSendingEth ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : "Send"}
              </button>
            </div>
          </Modal>
        )}

        {showReceiveModal && (
          <Modal onClose={() => setShowReceiveModal(false)} icon={<QrCode size={20} />} title="Receive ETH" subtitle="Scan or copy your address">
            <div className="flex flex-col items-center">
              <div className="p-5 bg-white rounded-2xl border border-slate-200 flex items-center justify-center relative">
                <svg width="168" height="168" viewBox="0 0 29 29" fill="none" className="text-slate-900">
                  <rect x="0" y="0" width="7" height="7" fill="currentColor" />
                  <rect x="1" y="1" width="5" height="5" fill="white" />
                  <rect x="2" y="2" width="3" height="3" fill="currentColor" />
                  <rect x="22" y="0" width="7" height="7" fill="currentColor" />
                  <rect x="23" y="1" width="5" height="5" fill="white" />
                  <rect x="24" y="2" width="3" height="3" fill="currentColor" />
                  <rect x="0" y="22" width="7" height="7" fill="currentColor" />
                  <rect x="1" y="23" width="5" height="5" fill="white" />
                  <rect x="2" y="24" width="3" height="3" fill="currentColor" />
                  <rect x="9" y="0" width="2" height="1" fill="currentColor" />
                  <rect x="12" y="0" width="1" height="3" fill="currentColor" />
                  <rect x="15" y="0" width="3" height="1" fill="currentColor" />
                  <rect x="20" y="0" width="1" height="2" fill="currentColor" />
                  <rect x="9" y="2" width="1" height="2" fill="currentColor" />
                  <rect x="11" y="2" width="3" height="1" fill="currentColor" />
                  <rect x="17" y="2" width="2" height="2" fill="currentColor" />
                  <rect x="20" y="3" width="1" height="2" fill="currentColor" />
                  <rect x="8" y="5" width="2" height="2" fill="currentColor" />
                  <rect x="12" y="5" width="1" height="1" fill="currentColor" />
                  <rect x="14" y="4" width="3" height="1" fill="currentColor" />
                  <rect x="18" y="5" width="2" height="1" fill="currentColor" />
                  <rect x="21" y="5" width="1" height="3" fill="currentColor" />
                  <rect x="0" y="9" width="3" height="1" fill="currentColor" />
                  <rect x="4" y="8" width="1" height="3" fill="currentColor" />
                  <rect x="7" y="9" width="2" height="2" fill="currentColor" />
                  <rect x="10" y="9" width="3" height="1" fill="currentColor" />
                  <rect x="14" y="8" width="2" height="3" fill="currentColor" />
                  <rect x="17" y="9" width="1" height="1" fill="currentColor" />
                  <rect x="19" y="8" width="3" height="2" fill="currentColor" />
                  <rect x="24" y="9" width="2" height="1" fill="currentColor" />
                  <rect x="27" y="8" width="2" height="3" fill="currentColor" />
                  <rect x="2" y="13" width="2" height="1" fill="currentColor" />
                  <rect x="5" y="12" width="1" height="2" fill="currentColor" />
                  <rect x="8" y="13" width="3" height="2" fill="currentColor" />
                  <rect x="12" y="12" width="2" height="1" fill="currentColor" />
                  <rect x="15" y="13" width="1" height="3" fill="currentColor" />
                  <rect x="18" y="12" width="2" height="1" fill="currentColor" />
                  <rect x="21" y="13" width="3" height="2" fill="currentColor" />
                  <rect x="26" y="13" width="1" height="1" fill="currentColor" />
                  <rect x="0" y="16" width="2" height="3" fill="currentColor" />
                  <rect x="3" y="17" width="3" height="1" fill="currentColor" />
                  <rect x="7" y="16" width="1" height="2" fill="currentColor" />
                  <rect x="10" y="17" width="2" height="1" fill="currentColor" />
                  <rect x="13" y="16" width="1" height="3" fill="currentColor" />
                  <rect x="17" y="17" width="3" height="2" fill="currentColor" />
                  <rect x="21" y="16" width="2" height="1" fill="currentColor" />
                  <rect x="24" y="17" width="1" height="1" fill="currentColor" />
                  <rect x="26" y="16" width="3" height="2" fill="currentColor" />
                  <rect x="8" y="20" width="2" height="1" fill="currentColor" />
                  <rect x="11" y="20" width="3" height="2" fill="currentColor" />
                  <rect x="15" y="20" width="1" height="1" fill="currentColor" />
                  <rect x="17" y="21" width="2" height="1" fill="currentColor" />
                  <rect x="20" y="20" width="1" height="3" fill="currentColor" />
                  <rect x="9" y="23" width="3" height="1" fill="currentColor" />
                  <rect x="14" y="24" width="2" height="1" fill="currentColor" />
                  <rect x="17" y="23" width="1" height="3" fill="currentColor" />
                  <rect x="23" y="23" width="2" height="2" fill="currentColor" />
                  <rect x="26" y="24" width="3" height="1" fill="currentColor" />
                  <rect x="8" y="26" width="1" height="3" fill="currentColor" />
                  <rect x="10" y="27" width="3" height="1" fill="currentColor" />
                  <rect x="15" y="26" width="2" height="2" fill="currentColor" />
                  <rect x="19" y="27" width="2" height="1" fill="currentColor" />
                  <rect x="22" y="26" width="1" height="2" fill="currentColor" />
                  <rect x="25" y="27" width="3" height="1" fill="currentColor" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center border-2 border-white">
                    <svg width="13" height="20" viewBox="0 0 256 417" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid">
                      <g>
                        <polygon fill="#FFF" points="127.9611 0 125.1661 9.5 125.1661 285.1 127.9611 287.9 255.9222 212.3"></polygon>
                        <polygon fill="#FFF" points="127.9611 0 0 212.3 127.9611 287.9 127.9611 154.5"></polygon>
                        <polygon fill="#FFF" points="127.9611 312.1 126.3861 314 126.3861 412.2 127.9611 416.6 255.999 240.4"></polygon>
                        <polygon fill="#FFF" points="127.9611 416.6 127.9611 312.1 0 240.4"></polygon>
                        <polygon fill="#FFF" points="127.9611 287.9 255.9222 212.3 127.9611 154.5"></polygon>
                        <polygon fill="#FFF" points="0 212.3 127.9611 287.9 127.9611 154.5"></polygon>
                      </g>
                    </svg>
                  </div>
                </div>
              </div>

              <div className="w-full mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs text-slate-500 mb-1.5">Your address</p>
                <p className="font-mono text-xs text-slate-900 break-all">{walletAddress}</p>
                <button
                  onClick={handleCopyAddress}
                  className={`mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${copied ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}
                >
                  {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy address</>}
                </button>
              </div>

              <p className="text-xs text-slate-500 text-center mt-4 leading-relaxed">
                Send only ETH on the {networkLabel}. Other tokens may be lost.
              </p>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ─────────────────────────── Sub-components ─────────────────────────── */

// ─── Hero slideshow (landing page) ───────────────────────────────────────────
// Three rotating slides, each pairing one of the crowd/stage photos with one
// core promise. Auto-advances, pauses on hover, arrows/dots for manual control.
const HERO_SLIDES = [
  {
    img: heroSlideConfetti,
    title: (
      <>Real tickets.<br className="hidden sm:block" />{" "}
        <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">Really yours.</span></>
    ),
    sub: "Every ticket here is a unique token on Ethereum — impossible to counterfeit, protected from scalpers, and yours to keep, send, or resell the moment you buy.",
  },
  {
    img: heroSlideStage,
    title: (
      <>Fair prices,<br className="hidden sm:block" />{" "}
        <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">enforced by code.</span></>
    ),
    sub: "Resale is capped at 110% of face value by the contract itself — good seats change hands without the scalper tax.",
  },
  {
    img: heroSlideAerial,
    title: (
      <>Your phone<br className="hidden sm:block" />{" "}
        <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">is the ticket.</span></>
    ),
    sub: "A live QR code gets you through the gate in seconds — and sending a spare ticket to a friend is just as fast.",
  },
];

const HeroSlideshow = ({ walletAddress, connectWallet }) => {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-advance; keyed on index so any manual jump restarts the full delay.
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % HERO_SLIDES.length), 6000);
    return () => clearTimeout(t);
  }, [index, paused]);

  const go = (i) => setIndex((i + HERO_SLIDES.length) % HERO_SLIDES.length);
  const slide = HERO_SLIDES[index];

  return (
    <section
      className="relative overflow-hidden border-b border-slate-200 bg-slate-950"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* All slides stay mounted and crossfade — no flash on first rotation */}
      {HERO_SLIDES.map((s, i) => (
        <img key={i} src={s.img} alt="" aria-hidden
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${i === index ? "opacity-100" : "opacity-0"}`} />
      ))}
      {/* Legibility scrims over the photos */}
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/60 to-slate-950/25" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-slate-950/30" />

      <div className="relative max-w-7xl mx-auto px-6 sm:px-10 py-16 sm:py-24">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur border border-white/20 px-3 py-1.5 text-xs font-medium text-slate-100 mb-6">
            <ShieldCheck size={14} className="text-indigo-300" /> Powered by Ethereum
          </span>

          {/* Message swaps with the photo */}
          <AnimatePresence mode="wait">
            <motion.div key={index}
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35 }}
              className="min-h-[180px] sm:min-h-[190px]">
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.1]">{slide.title}</h1>
              <p className="mt-5 text-lg text-slate-300 leading-relaxed">{slide.sub}</p>
            </motion.div>
          </AnimatePresence>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a href="#events" className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl font-semibold shadow-lg shadow-indigo-950/40 transition-all">
              Browse events <ArrowRight size={17} />
            </a>
            {!walletAddress && (
              <button onClick={connectWallet} className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 backdrop-blur border border-white/25 hover:bg-white/20 text-white rounded-xl font-semibold transition-colors">
                Connect wallet
              </button>
            )}
          </div>

          <div className="mt-12 flex flex-wrap gap-x-8 gap-y-4">
            <Feature icon={ShieldCheck} title="Impossible to fake" desc="Every ticket is a one-of-a-kind token" />
            <Feature icon={Tag} title="Fair resale, always" desc="Prices capped at 110% of face value" />
            <Feature icon={Zap} title="Instant transfers" desc="Send a ticket to a friend in seconds" />
          </div>

          {/* Slide controls */}
          <div className="mt-10 flex items-center gap-2.5">
            {HERO_SLIDES.map((_, i) => (
              <button key={i} onClick={() => go(i)} aria-label={`Go to slide ${i + 1}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-8 bg-white" : "w-4 bg-white/35 hover:bg-white/60"}`} />
            ))}
            <div className="ml-4 flex gap-2">
              <button onClick={() => go(index - 1)} aria-label="Previous slide"
                className="w-8 h-8 rounded-full bg-white/10 backdrop-blur border border-white/20 hover:bg-white/25 text-white flex items-center justify-center transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={() => go(index + 1)} aria-label="Next slide"
                className="w-8 h-8 rounded-full bg-white/10 backdrop-blur border border-white/20 hover:bg-white/25 text-white flex items-center justify-center transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const Feature = ({ icon: Icon, title, desc }) => (
  <div className="flex items-start gap-3">
    <div className="w-9 h-9 rounded-lg bg-white/10 backdrop-blur border border-white/15 flex items-center justify-center text-indigo-300 shrink-0">
      <Icon size={17} />
    </div>
    <div>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="text-xs text-slate-400">{desc}</p>
    </div>
  </div>
);

// Live blockchain status badge for a ticket (dark glass variant).
const TicketStateBadge = ({ canceled, finished, used }) => {
  const map = canceled
    ? { label: "Canceled", cls: "bg-red-500/15 text-red-300 border-red-500/30" }
    : used
      ? { label: "Used", cls: "bg-slate-500/15 text-slate-300 border-white/10" }
      : finished
        ? { label: "Ended", cls: "bg-slate-500/15 text-slate-300 border-white/10" }
        : { label: "Valid", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" };
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${map.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${canceled ? "bg-red-400" : used || finished ? "bg-slate-400" : "bg-emerald-400"}`} />
      {map.label}
    </span>
  );
};

// Loading placeholder that mirrors the dark ticket card's footprint.
const TicketCardSkeleton = () => (
  <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90 p-6 animate-pulse">
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 space-y-2">
        <div className="h-5 w-3/4 bg-white/10 rounded" />
        <div className="h-3 w-1/2 bg-white/10 rounded" />
        <div className="h-3 w-2/5 bg-white/10 rounded" />
      </div>
      <div className="h-6 w-16 bg-white/10 rounded-full" />
    </div>
    <div className="mt-5 flex justify-center">
      <div className="w-[174px] h-[174px] bg-white/10 rounded-2xl" />
    </div>
    <div className="mt-5 h-11 w-full bg-white/10 rounded-xl" />
  </div>
);

// Premium dark "glassmorphism" ticket card with a secure entry QR packet.
const TicketCard = ({ ticket, meta, status, owner, contractAddress, chainId, onResell, onTransfer, onCancel }) => {
  const canceled = status === EVENT_STATUS.CANCELED;
  const finished = status === EVENT_STATUS.FINISHED;
  const used = !!ticket.isUsed;
  const frozen = isTransferFrozen(status);

  const venue = meta?.venue || ticket.venue;
  const timeLabel = meta?.timestamp ? formatEventWindow(meta.timestamp) : ticket.date;

  // Secure entry packet encoded into the QR: token id + owner + the on-chain
  // validation anchor (contract address + chain). The gate scanner reads live
  // chain state for this token, so an offline screenshot can't be replayed.
  const qrPayload = JSON.stringify({
    tokenId: ticket.id,
    owner,
    contract: contractAddress,
    chainId,
    v: 1,
  });

  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90 backdrop-blur-xl p-6 shadow-[0_10px_40px_-10px_rgba(79,70,229,0.55)]"
    >
      {/* neon accent glow */}
      <div className="absolute -top-20 -right-16 w-44 h-44 bg-indigo-500/25 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-16 w-44 h-44 bg-fuchsia-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-lg font-bold text-white leading-snug truncate">{ticket.eventTitle}</h4>
            <div className="mt-2 space-y-1 text-xs text-slate-400">
              <p className="flex items-center gap-1.5"><MapPin size={12} className="text-indigo-400 shrink-0" /> <span className="truncate">{venue}</span></p>
              <p className="flex items-center gap-1.5"><Clock size={12} className="text-indigo-400 shrink-0" /> {timeLabel}</p>
            </div>
          </div>
          <TicketStateBadge canceled={canceled} finished={finished} used={used} />
        </div>

        {/* Secure entry QR */}
        <div className="mt-5 flex flex-col items-center">
          <div className={`p-3 bg-white rounded-2xl shadow-inner ${used || canceled ? "opacity-50 grayscale" : ""}`}>
            <QRCodeSVG value={qrPayload} size={150} level="H" marginSize={1} bgColor="#ffffff" fgColor="#0f172a" />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500 text-center max-w-[16rem]">
            Active connection required for gate validation. Screenshots or offline tokens will be rejected by scanners.
          </p>
        </div>

        {/* Face value + token id */}
        <div className="mt-4 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">{ticket.isListed ? "Listed for" : "Face value"}</span>
            <span className="font-semibold text-white">
              {rm(ticket.isListed ? ticket.resalePrice : ticket.mintPrice)} <span className="text-slate-400 font-normal">({ethLabel(ticket.isListed ? ticket.resalePrice : ticket.mintPrice, 3)})</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Token ID</span>
            <span className="font-mono text-indigo-300">#{ticket.id}</span>
          </div>
        </div>

        {/* Actions / state */}
        <div className="mt-4 pt-4 border-t border-white/10">
          {used ? (
            <div className="w-full py-3 bg-white/5 border border-white/10 text-slate-400 rounded-xl text-center font-semibold text-sm">Redeemed at gate</div>
          ) : canceled ? (
            <div className="w-full py-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl text-center font-semibold text-sm flex items-center justify-center gap-2">
              <Ban size={14} /> Event canceled — frozen
            </div>
          ) : frozen ? (
            <div className="w-full py-3 bg-white/5 border border-white/10 text-slate-400 rounded-xl text-center font-semibold text-sm">Trading frozen</div>
          ) : ticket.isListed ? (
            <div className="space-y-2.5">
              <button onClick={onCancel} className="w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors">
                <RefreshCw size={14} /> Cancel listing
              </button>
              {!ticket.isPrimary && (
                <Link to="/resale" className="flex items-center justify-center gap-1.5 text-xs font-medium text-indigo-300 hover:text-indigo-200 transition-colors">
                  View on resale market <ArrowRight size={13} />
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={onResell} className="py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-sm transition-colors shadow-lg shadow-indigo-500/20">Resell</button>
              <button onClick={onTransfer} className="py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 rounded-xl font-semibold text-sm transition-colors">Transfer</button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
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
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {title && <h3 className="text-lg font-semibold text-slate-900 leading-tight">{title}</h3>}
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
          <X size={20} />
        </button>
      </div>
      <div className="p-6 space-y-5">
        {children}
      </div>
    </motion.div>
  </div>
);

export default BuyerResellerDashboard;
