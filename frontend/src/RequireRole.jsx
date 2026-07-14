import { Link, Navigate } from "react-router-dom";
import { useTicketWallet } from "./useTicketWallet";

// Client-side route guard.
// IMPORTANT: this is UX-only. Real authority is enforced on-chain
// (onlyOwner / onlyWhitelistedOrganizer) and in the backend (verifyPrivyToken).
// `allow` is a list of roles permitted to view the route:
//   "admin" | "gatekeeper" -> email-allowlist roles (ROLE_CONFIG)
//   "buyer" | "organizer"  -> any authenticated user (organizer self-gates onboarding)
const Spinner = () => (
  <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div style={{ width: 36, height: 36, border: "3px solid #6366f1", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
  </div>
);

export default function RequireRole({ allow, children, redirectTo = "/" }) {
  const { ready, authenticated, resolvedRole, roleLoading, login } = useTicketWallet();

  if (!ready) return <Spinner />;

  if (!authenticated) {
    // Never a dead end: bare full-screen routes (organizer/gatekeeper/admin)
    // render this with no navbar, so it must offer its own way back home.
    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ color: "#94a3b8", fontSize: 14 }}>Please sign in to continue.</p>
        <button onClick={login} style={{ padding: "10px 24px", backgroundColor: "#6366f1", color: "#fff", border: "none", borderRadius: 12, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", cursor: "pointer" }}>
          Sign In
        </button>
        <Link to="/" style={{ color: "#64748b", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
          ← Back to home
        </Link>
      </div>
    );
  }

  // "buyer" = any authenticated user → no need to wait for async role resolution.
  if (allow.includes("buyer")) return children;

  // Role-specific routes: wait for the resolved role, then enforce it.
  if (roleLoading) return <Spinner />;
  if (!allow.includes(resolvedRole)) return <Navigate to={redirectTo} replace />;
  return children;
}
