import { create } from 'zustand'

// Sistema de toast global — fila única, máx 3 visíveis por vez.
// Uso: import { toast } from '../toast'; toast.success('Salvo!')

const MAX_VISIBLE = 3
const DURATIONS = { success: 4000, info: 4000, error: 6000 }

let idCounter = 0

export const useToasts = create((set, get) => ({
  toasts: [],   // visíveis (máx MAX_VISIBLE)
  queue: [],    // aguardando vaga

  push: (type, msg) => {
    const id = ++idCounter
    const duration = DURATIONS[type] ?? 4000
    const item = { id, type, msg, duration }
    const { toasts, queue } = get()
    if (toasts.length < MAX_VISIBLE) {
      set({ toasts: [...toasts, item] })
    } else {
      set({ queue: [...queue, item] })
    }
    return id
  },

  dismiss: (id) => {
    const { toasts, queue } = get()
    const stillVisible = toasts.filter(t => t.id !== id)
    if (stillVisible.length < toasts.length && queue.length > 0) {
      const [next, ...restQueue] = queue
      set({ toasts: [...stillVisible, next], queue: restQueue })
    } else {
      set({ toasts: stillVisible, queue: queue.filter(t => t.id !== id) })
    }
  },
}))

export const toast = {
  success: (msg) => useToasts.getState().push('success', msg),
  error:   (msg) => useToasts.getState().push('error', msg),
  info:    (msg) => useToasts.getState().push('info', msg),
}
