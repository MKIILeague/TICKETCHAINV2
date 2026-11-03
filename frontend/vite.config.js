import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const appBuildId = Date.now().toString(36)

// https://vite.dev/config/
export default defineConfig({
  define: { 'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(appBuildId) },
  plugins: [
    react(),
    {
      name: 'ticketchain-build-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'app-version.json', source: JSON.stringify({ buildId: appBuildId }) })
      },
    },
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'icons.svg'],
      manifest: {
        name: 'TicketChain — Decentralized Event Ticketing',
        short_name: 'TicketChain',
        description:
          'A decentralized, secure, and transparent marketplace for event tickets powered by blockchain.',
        theme_color: '#0b0f19',
        background_color: '#0b0f19',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // HTML must come from the current deployment on navigation. Cached
        // app shells previously kept the old minting code alive after deploys.
        globPatterns: ['**/*.{js,css,svg,png,ico}'],
        navigateFallback: null,
        skipWaiting: false,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [{
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'ticketchain-pages',
            networkTimeoutSeconds: 5,
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 12, maxAgeSeconds: 86400 },
          },
        }],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  server: {
    // Force vite dev server to only serve on localhost (not 127.0.0.1)
    // This prevents Privy's "Origin not allowed" 403 error
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
})
