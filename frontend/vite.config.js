import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Force vite dev server to only serve on localhost (not 127.0.0.1)
    // This prevents Privy's "Origin not allowed" 403 error
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
})
