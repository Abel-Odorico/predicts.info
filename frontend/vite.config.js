import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8110', changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        assetFileNames: `assets/[name]-[hash]-${Date.now()}.[ext]`,
        chunkFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        entryFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-')) {
            return 'recharts'
          }
          if (id.includes('node_modules/react-dom')) return 'react-dom'
          if (id.includes('node_modules/react-router')) return 'react-router'
        },
      }
    }
  }
})
