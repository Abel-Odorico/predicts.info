// Diagnóstico temporário — caça ao crash "problema ocorreu repetidamente" só
// em Safari iOS em /apostas e /brasileirao (ver skill predicts, seção do dia
// 2026-07-16). Um crash nativo do WebKit mata a aba sem chance de reportar o
// erro em si, então em vez de tentar capturar o erro, mandamos CHECKPOINTS de
// progresso em tempo real — o último que chegar no servidor é onde morreu.
// sendBeacon não bloqueia unload e sobrevive à navegação/fechamento da aba.
// Remover este arquivo + import + endpoint /api/diag/* quando o bug for achado.

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

export function checkpoint(event, extra = {}) {
  send('/diag/checkpoint', { event, ...extra })
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
