// Captura global de erro JS + promise rejeitada, reportado pro admin em
// /admin/logs. sendBeacon não bloqueia unload e sobrevive à navegação/
// fechamento da aba.

function send(path, body) {
  try {
    const payload = JSON.stringify({ ...body, path: window.location.pathname, ts: Date.now() })
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`/api${path}`, new Blob([payload], { type: 'application/json' }))
    } else {
      fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
    }
  } catch { /* diagnóstico não pode quebrar a página */ }
}

// Deploy troca o hash dos chunks (vite build limpa o dist a cada build); aba
// aberta na hora do deploy tenta lazy-load (React.lazy) um arquivo que já não
// existe mais e recebe esse erro — não é bug de lógica, é cache de rota velha.
// Mensagem varia por engine: WebKit "Importing a module script failed",
// Chrome/V8 "Failed to fetch dynamically imported module". Recarrega 1x
// (sessionStorage evita loop se o servidor realmente estiver fora do ar).
const CHUNK_ERROR_RE = /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module/i

function isChunkLoadError(message) {
  return CHUNK_ERROR_RE.test(message || '')
}

function reloadOnceForChunkError() {
  const key = 'predicts_chunk_reload_at'
  const last = Number(sessionStorage.getItem(key) || 0)
  if (Date.now() - last > 15000) {
    sessionStorage.setItem(key, String(Date.now()))
    window.location.reload()
    return true
  }
  return false
}

window.addEventListener('error', (e) => {
  if (isChunkLoadError(e.message) && reloadOnceForChunkError()) return
  send('/diag/error', {
    message: e.message,
    stack: e.error?.stack || null,
    source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null,
  })
})

window.addEventListener('unhandledrejection', (e) => {
  const message = e.reason?.message || String(e.reason)
  if (isChunkLoadError(message) && reloadOnceForChunkError()) return
  send('/diag/error', {
    message: 'unhandledrejection: ' + message,
    stack: e.reason?.stack || null,
  })
})
