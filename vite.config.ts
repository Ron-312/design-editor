import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev runs Vite in middlewareMode inside the Node server on the editor port, so no Vite port is opened here.
export default defineConfig({
  root: 'src/ui',
  appType: 'custom',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    strictPort: true,
    watch: {
      ignored: (path: string) => /[\\/](projects|\.editor)([\\/]|$)/.test(path),
    },
  },
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
})
