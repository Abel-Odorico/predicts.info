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

window.addEventListener('error', (e) => {
  send('/diag/error', {
    message: e.message,
    stack: e.error?.stack || null,
    source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null,
  })
})

window.addEventListener('unhandledrejection', (e) => {
  send('/diag/error', {
    message: 'unhandledrejection: ' + (e.reason?.message || String(e.reason)),
    stack: e.reason?.stack || null,
  })
})
