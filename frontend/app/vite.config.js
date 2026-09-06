import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Where the nginx gateway is reachable from the machine running `npm run dev`.
// In docker-compose the gateway publishes 8000:80.
const GATEWAY = globalThis.process?.env?.VITE_GATEWAY_ORIGIN ?? 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8080,          // the Dockerfile and the gateway upstream both expect 8080
    allowedHosts: ['frontend'],

    // The app calls root-relative paths (/api/..., /ws/...) because auth is
    // cookie-based and must stay same-origin. In production nginx serves the
    // build and proxies those prefixes; in dev, Vite stands in for it -- so
    // `npm run dev` works on its own as long as the gateway is up.
    proxy: {
      '/api': { target: GATEWAY, changeOrigin: true },
      '/ws': { target: GATEWAY.replace(/^http/, 'ws'), ws: true },
    },
  },
})
