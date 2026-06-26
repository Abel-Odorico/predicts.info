import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })

  // Quando SW novo ativa e reclama os clients, emite evento para mostrar banner
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SW_ACTIVATED') {
      // Só notifica se havia um SW anterior (não é primeira instalação)
      if (navigator.serviceWorker.controller) {
        window.dispatchEvent(new CustomEvent('sw-update-ready'))
      }
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
