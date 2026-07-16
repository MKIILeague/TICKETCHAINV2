import React, { useState } from "react";
import { BrowserRouter, Routes, Route, Outlet, NavLink, Link, Navigate } from "react-router-dom";
import { Wallet, LogIn, LogOut, Building2, Menu, X, User, Repeat } from "lucide-react";
import BrandMark from "./BrandMark";
import { useTicketWallet } from "./useTicketWallet";
import { useProfile } from "./useProfile";
import RequireRole from "./RequireRole";
import BuyerResellerDashboard from "./BuyerResellerDashboard";
import EventCheckout from "./EventCheckout";
import OrganizerDashboard from "./OrganizerDashboard";
import GatekeeperTerminal from "./GatekeeperTerminal";
import SystemAdminConsole from "./SystemAdminConsole";
import AdminLogin from "./AdminLogin";
import Profile from "./Profile";
import ResaleMarketplace from "./ResaleMarketplace";

// ─── Consumer navbar (UX only — real authority is on-chain) ──────────────────
function Navbar() {
  const { ready, authenticated, address, login, logout, isAdmin, isGatekeeper, isOrganizer } = useTicketWallet();
  const { displayName } = useProfile(address);
  const [isOpen, setIsOpen] = useState(false);

  // Approved organizers go straight to their dashboard — everyone else lands on
  // the smart entry at /organizer (sign-in / register / status screens).
  const organizerHref = isOrganizer ? "/organizer/dashboard" : "/organizer";

  // Avatar initial for the profile chip — use the first letter of the display
  // name when it's an actual name (not a 0x… address), else fall back to an icon.
  const avatarInitial = (displayName || "").trim().charAt(0);
  const hasInitial = /[a-zA-Z]/.test(avatarInitial);
  
  const link = ({ isActive }) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive ? "text-indigo-700 bg-indigo-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
    }`;

  const mobileLink = ({ isActive }) =>
    `block px-4 py-3 rounded-lg text-base font-medium transition-colors ${
      isActive ? "text-indigo-700 bg-indigo-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
    }`;

  return (
    <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-slate-200">
      {/* Brand accent line — mirrored on the footer */}
      <div className="h-0.5 bg-gradient-to-r from-indigo-600 via-violet-500 to-cyan-400" />
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        
        {/* Left side: Logo & Mobile Menu Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <button 
            className="sm:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          
          <NavLink to="/" onClick={() => setIsOpen(false)} className="group flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-indigo-200 group-hover:shadow-indigo-300 transition-shadow">
              <BrandMark className="text-white w-6 h-6" />
            </div>
            <span className="font-bold tracking-tight text-base leading-none">
              <span className="text-slate-900">Ticket</span>
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">Chain</span>
              <span className="hidden lg:block text-[10px] font-medium text-slate-400 tracking-wide mt-0.5">Own what you attend</span>
            </span>
          </NavLink>
        </div>

        {/* Desktop Links */}
        <div className="hidden sm:flex items-center gap-1">
          <NavLink to="/" end className={link}>Events</NavLink>
          <NavLink to="/resale" className={link}>
            <span className="inline-flex items-center gap-1.5"><Repeat size={14} /> Resale</span>
          </NavLink>
          <NavLink to="/wallet" className={link}>Wallet</NavLink>
          <NavLink to={organizerHref} className={link}>
            <span className="inline-flex items-center gap-1.5"><Building2 size={14} /> Organizer</span>
          </NavLink>
          {isAdmin && <NavLink to="/admin/dashboard" className={link}>Admin</NavLink>}
          {isGatekeeper && <NavLink to="/gatekeeper" className={link}>Gate</NavLink>}
        </div>

        {/* Auth Buttons */}
        <div className="flex items-center gap-3 shrink-0">
          {ready && authenticated ? (
            <>
              <NavLink
                to="/profile"
                title="Edit your profile"
                className="group inline-flex items-center gap-2 max-w-[190px] rounded-full border border-slate-200 bg-slate-100 pl-1 pr-1 md:pr-3 py-1 hover:bg-indigo-50 hover:border-indigo-200 transition-colors"
              >
                <span className="relative w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {hasInitial ? avatarInitial.toUpperCase() : <User size={15} />}
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
                </span>
                <span className="hidden md:inline truncate text-xs font-medium text-slate-700 group-hover:text-indigo-700">{displayName}</span>
              </NavLink>
              <button onClick={logout} title="Sign out" className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 hover:bg-red-100 text-red-600 rounded-lg text-sm font-medium transition-colors">
                <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          ) : (
            <button onClick={login} className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-lg text-sm font-semibold shadow-sm shadow-indigo-200 transition-all">
              <LogIn size={14} /> Sign in
            </button>
          )}
        </div>
      </nav>

      {/* Mobile Menu Dropdown */}
      {isOpen && (
        <div className="sm:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-2 shadow-lg">
          <NavLink to="/" end onClick={() => setIsOpen(false)} className={mobileLink}>Events</NavLink>
          <NavLink to="/resale" onClick={() => setIsOpen(false)} className={mobileLink}>
            <span className="inline-flex items-center gap-1.5"><Repeat size={16} /> Resale</span>
          </NavLink>
          <NavLink to="/wallet" onClick={() => setIsOpen(false)} className={mobileLink}>Wallet</NavLink>
          {authenticated && (
            <NavLink to="/profile" onClick={() => setIsOpen(false)} className={mobileLink}>
              <span className="inline-flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {hasInitial ? avatarInitial.toUpperCase() : <User size={15} />}
                </span>
                Edit profile
              </span>
            </NavLink>
          )}
          <NavLink to={organizerHref} onClick={() => setIsOpen(false)} className={mobileLink}>
            <span className="inline-flex items-center gap-1.5"><Building2 size={16} /> Organizer</span>
          </NavLink>
          {isAdmin && <NavLink to="/admin/dashboard" onClick={() => setIsOpen(false)} className={mobileLink}>Admin Dashboard</NavLink>}
          {isGatekeeper && <NavLink to="/gatekeeper" onClick={() => setIsOpen(false)} className={mobileLink}>Gate Terminal</NavLink>}
        </div>
      )}
    </header>
  );
}

const FooterLink = ({ to, children }) => (
  <Link to={to} className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">{children}</Link>
);

function Footer() {
  return (
    <footer className="mt-auto bg-white border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Brand + inline nav on one line */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center">
              <BrandMark className="text-white w-5 h-5" />
            </div>
            <span className="font-bold tracking-tight text-base">
              <span className="text-slate-900">Ticket</span>
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">Chain</span>
            </span>
            <span className="ml-1 inline-flex items-center rounded-full bg-slate-50 border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500">
              Ethereum · Sepolia
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <FooterLink to="/">Events</FooterLink>
            <FooterLink to="/resale">Resale market</FooterLink>
            <FooterLink to="/wallet">Your tickets</FooterLink>
            <FooterLink to="/organizer">Organizer portal</FooterLink>
          </nav>
        </div>

        <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
          <p>© {new Date().getFullYear()} TicketChain. Built on Ethereum.</p>
          <p>Every ticket, verifiable on-chain.</p>
        </div>
      </div>
      {/* Brand accent line — mirrored from the navbar */}
      <div className="h-0.5 bg-gradient-to-r from-indigo-600 via-violet-500 to-cyan-400" />
    </footer>
  );
}

// Shared layout for consumer routes (navbar + footer).
function ConsumerLayout() {
  return (
    <>
      <Navbar />
      <main className="flex-1 w-full bg-slate-100">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

// Pulls identity from the hook and forwards the props every page expects.
// connectWallet === Privy login.
function useChainProps() {
  const { address, wallet, login, logout, authenticated, ready } = useTicketWallet();
  return { walletAddress: address, wallet, connectWallet: login, logout, authenticated, ready };
}

function MarketplacePage() {
  const p = useChainProps();
  return <BuyerResellerDashboard {...p} view="events" />;
}
function WalletPage() {
  const p = useChainProps();
  return <BuyerResellerDashboard {...p} view="wallet" />;
}
function ResalePage() {
  const p = useChainProps();
  return <ResaleMarketplace {...p} />;
}
function EventCheckoutPage() {
  const p = useChainProps();
  return <EventCheckout {...p} />;
}
function OrganizerEntryPage() {
  const p = useChainProps();
  return <OrganizerDashboard {...p} mode="entry" />;
}
function OrganizerDashboardPage() {
  const p = useChainProps();
  return <OrganizerDashboard {...p} mode="dashboard" />;
}
function GatekeeperPage() {
  const p = useChainProps();
  return <GatekeeperTerminal {...p} />;
}
function AdminConsolePage() {
  const p = useChainProps();
  return <SystemAdminConsole {...p} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Consumer routes — share the navbar + footer chrome */}
        <Route element={<ConsumerLayout />}>
          {/* Marketplace IS the landing page; viewable while logged out (public RPC) */}
          <Route path="/" element={<MarketplacePage />} />
          <Route path="/event/:eventId" element={<EventCheckoutPage />} />
          {/* Public per-token resale storefront — viewable logged out via public RPC */}
          <Route path="/resale" element={<ResalePage />} />
          <Route path="/wallet" element={<RequireRole allow={["buyer"]}><WalletPage /></RequireRole>} />
          <Route path="/profile" element={<RequireRole allow={["buyer"]}><Profile /></RequireRole>} />
          {/* Single smart entry: sign-in / register / pending / rejected / → dashboard.
              Handles the signed-out state itself, so no RequireRole wrapper. */}
          <Route path="/organizer" element={<OrganizerEntryPage />} />
          {/* Old bookmarks/links from the register/login split keep working */}
          <Route path="/organizer/register" element={<Navigate to="/organizer" replace />} />
          <Route path="/organizer/login" element={<Navigate to="/organizer" replace />} />
          <Route path="/admin/login" element={<AdminLogin />} />
        </Route>

        {/* Bare full-screen routes — no consumer navbar */}
        <Route path="/organizer/dashboard" element={<RequireRole allow={["organizer"]} redirectTo="/organizer"><OrganizerDashboardPage /></RequireRole>} />
        <Route path="/gatekeeper" element={<RequireRole allow={["gatekeeper"]}><GatekeeperPage /></RequireRole>} />
        <Route path="/admin/dashboard" element={<RequireRole allow={["admin"]} redirectTo="/admin/login"><AdminConsolePage /></RequireRole>} />
      </Routes>
    </BrowserRouter>
  );
}
