import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useState, useEffect, useMemo } from 'react';
import { fetchOrgStatus, getCachedOrgStatus } from './orgStatus';
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

// Authorization configuration — add emails here to grant roles.
// To make yourself admin: add your email to the admins array below.
const ROLE_CONFIG = {
  admins: ['admin@ticketchain.io', 'syedarfanmishu@gmail.com'], // ← add your email here
  gatekeepers: ['staff@venue.com', 'gatekeeper1@ticketchain.io'],
};

export const useTicketWallet = () => {
  const { login, logout, authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();

  // Prefer the Privy embedded wallet; fall back to the first connected wallet so
  // injected/MetaMask logins still work. (Tip: log in with the same method each
  // time so your address stays consistent between registration and login.)
  const wallet = (wallets || []).find((w) => w.walletClientType === 'privy') || (wallets || [])[0] || null;
  const [address, setAddress] = useState(null);

  useEffect(() => {
    setAddress(wallet ? wallet.address : null);
  }, [wallet]);

  const email = user?.email?.address?.toLowerCase() || null;

  // ── Synchronous email-based roles (admin / gatekeeper) — no flicker ──────────
  const emailRole = useMemo(() => {
    if (!authenticated || !email) return 'buyer';
    if (ROLE_CONFIG.admins.includes(email)) return 'admin';
    if (ROLE_CONFIG.gatekeepers.includes(email)) return 'gatekeeper';
    return 'buyer';
  }, [authenticated, email]);

  // ── Async "assigned staff" gatekeeper resolution from Firestore ──────────────
  // Organizers assign door staff by email (staff/{email} docs). Any signed-in
  // user whose email matches becomes a gatekeeper so they can open /gatekeeper
  // and validate tickets. Keyed on email (not wallet) since that's what the
  // organizer assigns. The hardcoded ROLE_CONFIG.gatekeepers still works too.
  const [isStaffGatekeeper, setIsStaffGatekeeper] = useState(false);
  const [staffChecked, setStaffChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Only users who aren't already admin/config-gatekeeper need this lookup.
    if (!authenticated || !email || emailRole !== 'buyer') {
      setIsStaffGatekeeper(false); setStaffChecked(true);
      return;
    }

    setStaffChecked(false);
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'staff', email));
        if (cancelled) return;
        setIsStaffGatekeeper(snap.exists());
        setStaffChecked(true);
      } catch (e) {
        if (cancelled) return;
        console.warn('[role] staff read failed:', e?.message);
        setStaffChecked(true); // don't strand the guard on a transient failure
      }
    })();

    return () => { cancelled = true; };
  }, [authenticated, email, emailRole]);

  // ── Async organizer resolution from Firestore application status ─────────────
  // We use Firestore "approved" because that is exactly the signal the Organizer
  // dashboard renders on (admin approval writes status:"approved" alongside the
  // on-chain whitelistOrganizer tx). The on-chain whitelist remains the REAL
  // authority and is enforced by the contract at mint time (onlyWhitelistedOrganizer).
  const [orgStatus, setOrgStatus] = useState('none'); // none | pending | approved | rejected
  const [orgApproved, setOrgApproved] = useState(false);
  // Start true: until the async check runs, we DON'T know the org status yet.
  // (If this starts false, guards see resolvedRole='buyer' on the first render
  // and redirect away before the check completes → a redirect loop.)
  const [orgChecked, setOrgChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Only buyers-by-email with a wallet need the organizer check.
    if (!authenticated || emailRole !== 'buyer' || !address) {
      setOrgStatus('none'); setOrgApproved(false); setOrgChecked(true);
      return;
    }

    // Seed instantly from the shared cache so re-navigating to an organizer
    // route doesn't flash the guard spinner or bounce to login while a fresh
    // read runs. The fetch below revalidates in the background.
    const cached = getCachedOrgStatus(address);
    if (cached) {
      setOrgStatus(cached.status);
      setOrgApproved(cached.status === 'approved');
      setOrgChecked(true);
    } else {
      setOrgChecked(false);
    }

    (async () => {
      try {
        const { status } = await fetchOrgStatus(address);
        if (cancelled) return;
        setOrgStatus(status);
        setOrgApproved(status === 'approved');
        setOrgChecked(true);
      } catch (e) {
        if (cancelled) return;
        console.warn('[role] firestore read failed:', e?.message);
        // Don't strand the guard spinner on a transient failure — resolve as
        // buyer; the dashboard's own check surfaces a retryable error if needed.
        setOrgChecked(true);
      }
    })();

    return () => { cancelled = true; };
  }, [authenticated, emailRole, address]);

  // ── Final resolved role ──────────────────────────────────────────────────────
  // Priority: admin > gatekeeper (config OR organizer-assigned staff) > organizer > buyer.
  const resolvedRole =
    emailRole !== 'buyer' ? emailRole          // admin or config gatekeeper
      : isStaffGatekeeper ? 'gatekeeper'        // organizer-assigned door staff
      : orgApproved ? 'organizer'
      : 'buyer';
  // The role is still resolving while an authenticated buyer-by-email either has
  // no address yet OR the organizer/staff checks haven't finished. Guards must
  // wait on this before deciding, otherwise they redirect prematurely (loop).
  const roleLoading =
    authenticated && emailRole === 'buyer' && (!address || !orgChecked || !staffChecked);

  const isAdmin = resolvedRole === 'admin';
  const isGatekeeper = resolvedRole === 'gatekeeper';
  const isOrganizer = resolvedRole === 'organizer';
  const isBuyer = resolvedRole === 'buyer';

  return {
    login,
    logout,
    authenticated,
    address,
    wallet,
    ready,
    user,
    userRole: resolvedRole,
    resolvedRole,
    orgStatus,
    roleLoading,
    isAdmin,
    isGatekeeper,
    isOrganizer,
    isBuyer,
  };
};
