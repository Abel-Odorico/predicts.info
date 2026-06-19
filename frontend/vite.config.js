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
      }
    }
  }
})
