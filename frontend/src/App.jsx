import React, { useState } from "react";
import { BrowserRouter, Routes, Route, Outlet, NavLink, useNavigate } from "react-router-dom";
import { Ticket as TicketIcon, Wallet, LogIn, LogOut, Building2, Menu, X } from "lucide-react";
import { useTicketWallet } from "./useTicketWallet";
import RequireRole from "./RequireRole";
import BuyerResellerDashboard from "./BuyerResellerDashboard";
import EventCheckout from "./EventCheckout";
import OrganizerLanding from "./OrganizerLanding";
import OrganizerDashboard from "./OrganizerDashboard";
import GatekeeperTerminal from "./GatekeeperTerminal";
import SystemAdminConsole from "./SystemAdminConsole";
import AdminLogin from "./AdminLogin";

// ─── Consumer navbar (UX only — real authority is on-chain) ──────────────────
function Navbar() {
  const { ready, authenticated, address, login, logout, isAdmin, isGatekeeper } = useTicketWallet();
  const [isOpen, setIsOpen] = useState(false);
  
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
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        
        {/* Left side: Logo & Mobile Menu Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <button 
            className="sm:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          
          <NavLink to="/" onClick={() => setIsOpen(false)} className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
              <TicketIcon className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-slate-900 tracking-tight text-base">TicketChain</span>
          </NavLink>
        </div>

        {/* Desktop Links */}
        <div className="hidden sm:flex items-center gap-1">
          <NavLink to="/" end className={link}>Events</NavLink>
          <NavLink to="/wallet" className={link}>Wallet</NavLink>
          <NavLink to="/organizer" className={link}>
            <span className="inline-flex items-center gap-1.5"><Building2 size={14} /> Organizer</span>
          </NavLink>
          {isAdmin && <NavLink to="/admin/dashboard" className={link}>Admin</NavLink>}
          {isGatekeeper && <NavLink to="/gatekeeper" className={link}>Gate</NavLink>}
        </div>

        {/* Auth Buttons */}
        <div className="flex items-center gap-3 shrink-0">
          {ready && authenticated ? (
            <>
              <span className="hidden md:inline-flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-3 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {address ? `${address.substring(0, 6)}…${address.substring(38)}` : "—"}
              </span>
              <button onClick={logout} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors">
                <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          ) : (
            <button onClick={login} className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-colors">
              <LogIn size={14} /> Sign in
            </button>
          )}
        </div>
      </nav>

      {/* Mobile Menu Dropdown */}
      {isOpen && (
        <div className="sm:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-2 shadow-lg">
          <NavLink to="/" end onClick={() => setIsOpen(false)} className={mobileLink}>Events</NavLink>
          <NavLink to="/wallet" onClick={() => setIsOpen(false)} className={mobileLink}>Wallet</NavLink>
          <NavLink to="/organizer" onClick={() => setIsOpen(false)} className={mobileLink}>
            <span className="inline-flex items-center gap-1.5"><Building2 size={16} /> Organizer</span>
          </NavLink>
          {isAdmin && <NavLink to="/admin/dashboard" onClick={() => setIsOpen(false)} className={mobileLink}>Admin Dashboard</NavLink>}
          {isGatekeeper && <NavLink to="/gatekeeper" onClick={() => setIsOpen(false)} className={mobileLink}>Gate Terminal</NavLink>}
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white py-10">
      <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-500 text-sm">
        <div className="flex items-center gap-2 font-semibold text-slate-700">
          <div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center">
            <TicketIcon size={13} className="text-white" />
          </div>
          TicketChain
        </div>
        <p>Tickets you actually own — verifiable on-chain.</p>
      </div>
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
function EventCheckoutPage() {
  const p = useChainProps();
  return <EventCheckout {...p} />;
}
function OrganizerRegisterPage() {
  const p = useChainProps();
  return <OrganizerDashboard {...p} mode="register" />;
}
function OrganizerLoginPage() {
  const p = useChainProps();
  return <OrganizerDashboard {...p} mode="login" />;
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
          <Route path="/wallet" element={<RequireRole allow={["buyer"]}><WalletPage /></RequireRole>} />
          <Route path="/organizer" element={<OrganizerLanding />} />
          <Route path="/organizer/register" element={<RequireRole allow={["buyer"]}><OrganizerRegisterPage /></RequireRole>} />
          <Route path="/organizer/login" element={<RequireRole allow={["buyer"]}><OrganizerLoginPage /></RequireRole>} />
          <Route path="/admin/login" element={<AdminLogin />} />
        </Route>

        {/* Bare full-screen routes — no consumer navbar */}
        <Route path="/organizer/dashboard" element={<RequireRole allow={["organizer"]} redirectTo="/organizer/login"><OrganizerDashboardPage /></RequireRole>} />
        <Route path="/gatekeeper" element={<RequireRole allow={["gatekeeper"]}><GatekeeperPage /></RequireRole>} />
        <Route path="/admin/dashboard" element={<RequireRole allow={["admin"]} redirectTo="/admin/login"><AdminConsolePage /></RequireRole>} />
      </Routes>
    </BrowserRouter>
  );
}
