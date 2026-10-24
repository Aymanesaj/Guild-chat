import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` talks to the running stack through the gateway on port 80.
const GATEWAY = 'http://localhost'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
	host: '0.0.0.0',
	port: 8080,
	allowedHosts: ['frontend'],
	proxy: {
	  '/api': { target: GATEWAY, changeOrigin: true },
	  '/ws': { target: GATEWAY, changeOrigin: true, ws: true },
	},
  },
  test: {
	environment: 'jsdom',
  },
})
