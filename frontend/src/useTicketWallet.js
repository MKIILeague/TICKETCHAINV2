import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useState, useEffect } from 'react';
import { fetchOrgStatus, getCachedOrgStatus } from './orgStatus';
import { withTimeout } from './asyncUtils';
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

// UI roles only. Contract ownership/whitelisting enforce chain authority.
const ROLE_CONFIG = {
  admins: ['admin@ticketchain.io', 'syedarfanmishu@gmail.com'],
  gatekeepers: ['staff@venue.com', 'gatekeeper1@ticketchain.io'],
};

export const useTicketWallet = () => {
  const { login, logout, authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();
  const wallet = authenticated
    ? (wallets || []).find((w) => w.walletClientType === 'privy') || wallets?.[0] || null
    : null;
  const address = wallet?.address || null;
  const email = (user?.email?.address || user?.google?.email || '').toLowerCase();
  const emailRole = !authenticated ? 'buyer'
    : ROLE_CONFIG.admins.includes(email) ? 'admin'
    : ROLE_CONFIG.gatekeepers.includes(email) ? 'gatekeeper' : 'buyer';
  const [staff, setStaff] = useState(null);
  const [organizer, setOrganizer] = useState(null);

  useEffect(() => {
    if (!authenticated || !email || emailRole !== 'buyer') return;
    let cancelled = false;
    (async () => {
      let gatekeeper = false;
      try { gatekeeper = (await withTimeout(getDoc(doc(db, 'staff', email)))).exists(); }
      catch (error) { console.warn('[role] staff lookup failed:', error.message); }
      if (!cancelled) setStaff({ email, gatekeeper });
    })();
    return () => { cancelled = true; };
  }, [authenticated, email, emailRole]);

  useEffect(() => {
    if (!authenticated || !address || emailRole !== 'buyer') return;
    let cancelled = false;
    (async () => {
      let status = getCachedOrgStatus(address)?.status || 'unregistered';
      try { status = (await fetchOrgStatus(address)).status; }
      catch (error) { console.warn('[role] organizer lookup failed:', error.message); }
      if (!cancelled) setOrganizer({ address, status });
    })();
    return () => { cancelled = true; };
  }, [authenticated, address, emailRole]);

  // Key async results to the current identity; never carry over another user's role.
  const cached = address ? getCachedOrgStatus(address) : null;
  const orgStatus = organizer?.address === address ? organizer.status : cached?.status || 'unregistered';
  const staffReady = !email || staff?.email === email;
  const orgReady = !!cached || organizer?.address === address;
  const roleLoading = authenticated && emailRole === 'buyer' && (!address || !staffReady || !orgReady);
  const resolvedRole = emailRole !== 'buyer' ? emailRole
    : authenticated && staff?.email === email && staff.gatekeeper ? 'gatekeeper'
    : authenticated && address && orgStatus === 'approved' ? 'organizer' : 'buyer';

  return {
    login, logout, authenticated, address, wallet, ready, user,
    userRole: resolvedRole, resolvedRole, orgStatus, roleLoading,
    isAdmin: resolvedRole === 'admin', isGatekeeper: resolvedRole === 'gatekeeper',
    isOrganizer: resolvedRole === 'organizer', isBuyer: resolvedRole === 'buyer',
  };
};
