import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { defineChain } from 'viem'
import './index.css'
import App from './App.jsx'

// Privy only allows the `localhost` origin (not 127.0.0.1 / [::1]). Redirect
// before React mounts so the embedded-wallet origin check doesn't 403.
const { hostname } = window.location
if (hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') {
  window.location.href = window.location.href.replace(hostname, 'localhost')
}

// Define Hardhat Localhost for Privy
const hardhatChain = defineChain({
  id: 31337,
  name: 'Hardhat Localhost',
  network: 'hardhat',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['http://127.0.0.1:8545'],
    },
    public: {
      http: ['http://127.0.0.1:8545'],
    },
  },
})

// Surfaces render/origin/403 errors instead of a blank (black) screen so the
// app never fails silently. (Documented behavior — see CLAUDE.md.)
class PrivyErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('App crashed:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0f19', color: '#f1f5f9', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ maxWidth: 560, width: '100%', background: '#1e2538', border: '1px solid #ef4444', borderRadius: 16, padding: '2rem' }}>
            <h1 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.02em', marginTop: 0 }}>Something went wrong</h1>
            <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>
              The app hit an error while loading. If this mentions an <strong>origin</strong> or <strong>403</strong> issue,
              make sure you are visiting <code style={{ color: '#818cf8' }}>http://localhost:5173</code> (not 127.0.0.1).
            </p>
            <pre style={{ background: '#0b0f19', border: '1px solid #334155', borderRadius: 8, padding: 12, fontSize: 12, color: '#f87171', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {String(this.state.error?.message || this.state.error)}
            </pre>
            <button onClick={() => window.location.reload()} style={{ marginTop: 8, padding: '10px 24px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}>
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrivyErrorBoundary>
      <PrivyProvider
        appId="cmpwse3mr000i0ejp1lre5fy9" // Use your actual Privy App ID
        config={{
          loginMethods: ['email', 'google'],
          embeddedWallets: {
            createOnLogin: 'all-users',
          },
          defaultChain: hardhatChain,
          supportedChains: [hardhatChain],
          appearance: {
            theme: 'dark',
            accentColor: '#6366f1',
          },
        }}
      >
        <App />
      </PrivyProvider>
    </PrivyErrorBoundary>
  </StrictMode>,
)
