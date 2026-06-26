import { Navigate } from "react-router-dom";
import { useTicketWallet } from "./useTicketWallet";

const btn = {
  padding: "12px 28px", backgroundColor: "#d97706", color: "#fff", border: "none",
  borderRadius: 12, fontWeight: 900, fontSize: 12, textTransform: "uppercase",
  letterSpacing: "0.1em", cursor: "pointer",
};

// Hidden admin entry point (/admin/login). Not linked from the consumer navbar.
// Real admin authority is the contract owner — this only routes the UI.
export default function AdminLogin() {
  const { ready, authenticated, isAdmin, login, logout, user } = useTicketWallet();

  if (ready && authenticated && isAdmin) return <Navigate to="/admin/dashboard" replace />;

  return (
    <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 420, width: "100%", background: "#1e2538", border: "1px solid #334155", borderRadius: 16, padding: "2.5rem", textAlign: "center" }}>
        <h1 style={{ color: "#fff", fontWeight: 900, fontSize: 20, textTransform: "uppercase", letterSpacing: "-0.02em" }}>Admin Console</h1>
        <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 8, marginBottom: 24 }}>
          Restricted access. Sign in with an authorised admin account.
        </p>
        {!authenticated ? (
          <button onClick={login} style={btn}>Sign In</button>
        ) : (
          <div>
            <p style={{ color: "#fbbf24", fontSize: 13, marginBottom: 16 }}>
              Signed in as {user?.email?.address || "this account"}, which is not an admin.
            </p>
            <button onClick={logout} style={btn}>Switch Account</button>
          </div>
        )}
      </div>
    </div>
  );
}
