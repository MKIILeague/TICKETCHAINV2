import { useState, useEffect } from "react";
import { User, Mail, Calendar, Wallet, Copy, Check, CheckCircle2, LogIn } from "lucide-react";
import { useTicketWallet } from "./useTicketWallet";
import { useProfile } from "./useProfile";

// Dedicated profile page (/profile). Lets a signed-in user attach a friendly
// name + birthday to their wallet so the app shows more than a raw 0x… address.
// Email and wallet address are read-only: email comes live from Privy, the
// address is the embedded wallet's. Name + birthday persist to Firestore
// (profiles/{address}) via useProfile.
export default function Profile() {
  const { ready, authenticated, address, user, login } = useTicketWallet();
  const { profile, loading, save } = useProfile(address);

  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const email = user?.email?.address || null;

  // Seed the form once the stored profile loads (and when switching accounts).
  useEffect(() => {
    setName(profile?.name || "");
    setBirthday(profile?.birthday || "");
  }, [profile]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  const handleSave = async () => {
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      await save({ name, birthday });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e?.message || "Could not save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Today, for the birthday input's max (no future birthdays).
  const todayISO = new Date().toISOString().slice(0, 10);

  const dirty =
    name !== (profile?.name || "") || birthday !== (profile?.birthday || "");

  if (!ready) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center text-slate-400">
        Loading…
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 flex flex-col items-center gap-4 text-center">
        <p className="text-slate-500">Please sign in to view your profile.</p>
        <button
          onClick={login}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors"
        >
          <LogIn size={15} /> Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 sm:px-10 py-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Your profile</h1>
        <p className="text-slate-500 mt-1">
          Add your details so your tickets and transfers are easy to recognize.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6">

        {/* Editable: name */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1.5">
            <User size={15} className="text-slate-400" /> Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Syed Arfan"
            maxLength={60}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
          />
        </div>

        {/* Editable: birthday */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1.5">
            <Calendar size={15} className="text-slate-400" /> Birthday
          </label>
          <input
            type="date"
            value={birthday}
            max={todayISO}
            onChange={(e) => setBirthday(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
          />
        </div>

        <div className="border-t border-slate-200 pt-6 space-y-4">
          {/* Read-only: email (from Privy) */}
          <div>
            <p className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <Mail size={14} className="text-slate-400" /> Email
            </p>
            <p className="text-sm text-slate-700">
              {email || <span className="text-slate-400">Not linked to this login</span>}
            </p>
          </div>

          {/* Read-only: wallet address with copy */}
          <div>
            <p className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <Wallet size={14} className="text-slate-400" /> Wallet address
            </p>
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-sm text-slate-700 truncate">
                {address || "Not connected"}
              </p>
              {address && (
                <button
                  onClick={handleCopy}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    copied
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || loading || !dirty}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 size={16} /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
