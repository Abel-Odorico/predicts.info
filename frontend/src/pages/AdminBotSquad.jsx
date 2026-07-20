import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { toast } from '../toast'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'
import TeamCrestFlag from '../components/TeamCrestFlag'

function normalizeDate(value) {
  if (!value) return null
  const hasTz = value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)
  return hasTz ? value : `${value}Z`
}

function fmtDateTime(value) {
  if (!value) return '—'
  return new Date(normalizeDate(value)).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

function fmtTimeOnly(value) {
  if (!value) return '—'
  return new Date(normalizeDate(value)).toLocaleString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
}

function isTodayBRT(value) {
  if (!value) return false
  const opts = { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }
  const d = new Date(normalizeDate(value))
  return d.toLocaleDateString('pt-BR', opts) === new Date().toLocaleDateString('pt-BR', opts)
}

// label + emoji + cor por arquétipo — diferenciação visual rápida no grid
const ARCHETYPE_META = {
  'torcedor-fanatico': { label: 'Torcedor Fanático', icon: '🔥', hue: 4   },
  'estatistica':       { label: 'Estatística',       icon: '📊', hue: 200 },
  'zebra':              { label: 'Zebra',             icon: '🐴', hue: 280 },
  'cauteloso':          { label: 'Cauteloso',         icon: '🛡️', hue: 160 },
  'goleada':            { label: 'Goleada',           icon: '💥', hue: 30  },
  'empatista':          { label: 'Empatista',         icon: '🤝', hue: 45  },
  'home-crente':        { label: 'Home-crente',       icon: '🏠', hue: 210 },
  'contrarian':         { label: 'Contrarian',        icon: '🔄', hue: 320 },
}

function archetypeMeta(a) {
  if (a && ARCHETYPE_META[a]) return ARCHETYPE_META[a]
  const label = a ? a.split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ') : '—'
  return { label, icon: '🎲', hue: 0 }
}

function archetypeLabel(a) { return archetypeMeta(a).label }

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase()
}

// Ordem pedida: risk, draw_affinity, fav_boost, stubbornness (0-1 step 0.05),
// goals_bias (-1..1), jitter_hours (1-120 inteiro) — ver steps.md passo 5.
const PARAM_FIELDS = [
  { key: 'risk',          label: 'Risco (cauda da distribuição)', min: 0,  max: 1,   step: 0.05 },
  { key: 'draw_affinity', label: 'Afinidade com empate',           min: 0,  max: 1,   step: 0.05 },
  { key: 'fav_boost',     label: 'Boost do time do coração',       min: 0,  max: 1,   step: 0.05 },
  { key: 'stubbornness',  label: 'Teimosia (revisão T-3h)',        min: 0,  max: 1,   step: 0.05 },
  { key: 'goals_bias',    label: 'Viés de gols',                   min: -1, max: 1,   step: 0.05 },
  { key: 'jitter_hours',  label: 'Jitter (horas)',                 min: 1,  max: 120, step: 1, integer: true },
]

// Switch liga/desliga reutilizável — mesma classe .llm-switch já global
// (ver pages/Admin.jsx), evita duplicar CSS de toggle nesta página nova.
function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`llm-switch${checked ? ' llm-switch--on' : ''}`}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked) }}
    >
      <span className="llm-switch__knob" />
    </button>
  )
}

export default function AdminBotSquad() {
  const { token } = useAuth()
  const [overview, setOverview] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [toggling, setToggling] = useState(false)
  const [editing, setEditing]   = useState(null) // { persona, draft }
  const [saving, setSaving]     = useState(false)
  const [running, setRunning]   = useState(false)
  const [runResult, setRunResult] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const r = await api.get('/admin/bot-squad/overview', token)
      setOverview(r)
    } catch (e) {
      toast.error(e?.message || 'Erro ao carregar Bot Squad')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleMaster() {
    if (!overview) return
    setToggling(true)
    try {
      const r = await api.post('/admin/bot-squad/toggle', { enabled: !overview.enabled }, token)
      setOverview(o => ({ ...o, enabled: r.enabled }))
      toast.success(r.enabled ? 'Bot Squad ativado' : 'Bot Squad desativado')
    } catch (e) {
      toast.error(e?.message || 'Erro ao alternar Bot Squad')
    } finally {
      setToggling(false)
    }
  }

  async function togglePersona(persona) {
    try {
      const r = await api.patch(`/admin/bot-squad/personas/${persona.id}`, { enabled: !persona.enabled }, token)
      setOverview(o => ({
        ...o,
        personas: o.personas.map(p => (p.id === persona.id ? { ...p, enabled: r.enabled } : p)),
      }))
      toast.success(r.enabled ? `${persona.name} ativada` : `${persona.name} desativada`)
    } catch (e) {
      toast.error(e?.message || 'Erro ao alternar persona')
    }
  }

  function openEdit(persona) {
    setEditing({
      persona,
      draft: {
        bio: persona.bio || '',
        favorite_team_code: persona.favorite_team_code || '',
        params: { ...(persona.params || {}) },
      },
    })
  }

  function closeEdit() { if (!saving) setEditing(null) }

  function setDraftField(field, value) {
    setEditing(e => (e ? { ...e, draft: { ...e.draft, [field]: value } } : e))
  }

  function setDraftParam(key, value) {
    setEditing(e => (e ? { ...e, draft: { ...e.draft, params: { ...e.draft.params, [key]: value } } } : e))
  }

  async function saveEdit() {
    if (!editing) return
    const { persona, draft } = editing
    const patch = {}

    const initialBio = persona.bio || ''
    if ((draft.bio || '').trim() !== initialBio) patch.bio = draft.bio.trim() || null

    const initialTeam = (persona.favorite_team_code || '').toUpperCase()
    const draftTeam = draft.favorite_team_code.trim().toUpperCase()
    if (draftTeam !== initialTeam) patch.favorite_team_code = draftTeam || null

    const paramsPatch = {}
    for (const f of PARAM_FIELDS) {
      const before = Number(persona.params?.[f.key])
      const after = Number(draft.params?.[f.key])
      if (!Number.isNaN(after) && after !== before) {
        paramsPatch[f.key] = f.integer ? Math.round(after) : after
      }
    }
    if (Object.keys(paramsPatch).length) patch.params = paramsPatch

    if (Object.keys(patch).length === 0) { closeEdit(); return }

    setSaving(true)
    try {
      const r = await api.patch(`/admin/bot-squad/personas/${persona.id}`, patch, token)
      setOverview(o => ({
        ...o,
        personas: o.personas.map(p => (p.id === persona.id
          ? { ...p, bio: r.bio, favorite_team_code: r.favorite_team_code, enabled: r.enabled, params: r.params }
          : p)),
      }))
      toast.success(`${persona.name} atualizada`)
      setEditing(null)
    } catch (e) {
      toast.error(e?.message || 'Erro ao salvar persona')
    } finally {
      setSaving(false)
    }
  }

  async function runDryRun() {
    setRunning(true)
    try {
      const r = await api.post('/admin/bot-squad/run?dry_run=true', {}, token)
      setRunResult(r)
      toast.success(`Simulação rodada — ${r.matches?.length || 0} jogo(s) na janela`)
    } catch (e) {
      toast.error(e?.message || 'Erro ao rodar simulação')
    } finally {
      setRunning(false)
    }
  }

  const stats = useMemo(() => {
    const personas = overview?.personas || []
    return {
      totalBets: personas.reduce((s, p) => s + (p.bets_total || 0), 0),
      betsToday: personas.filter(p => isTodayBRT(p.last_bet_at)).length,
      activePersonas: personas.filter(p => p.enabled).length,
      total: personas.length,
    }
  }, [overview])

  return (
    <div className="adm-shell">
      <div className="adm-header botsq-header">
        <div className="adm-header__left">
          <div className="adm-header__title">🤖 BOT SQUAD</div>
          <div className="adm-header__sub">predicts.info · 20 personas apostadoras · liga Boteco do Placar</div>
        </div>
        <div className="adm-header__actions">
          <a href="/admin" className="btn btn-ghost btn-sm">🛠 Painel Admin</a>
          <a href="/admin/whatsapp" className="btn btn-ghost btn-sm">💬 WhatsApp</a>
          <a href="/admin/sistema" className="btn btn-ghost btn-sm">🧬 Sistema</a>
        </div>
      </div>

      <div className="adm-pane fade-in-1">
        {loading && !overview ? (
          <Spinner />
        ) : (
          <>
            {/* ── Controle geral: master switch + stats ────────────────── */}
            <div className={`adm-card botsq-master-card${overview?.enabled ? ' botsq-master-card--on' : ''}`}>
              <div className="adm-card__head">
                <span className="adm-card__title">⚙️ Controle geral</span>
                <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
                  {loading ? '…' : '↻ Atualizar'}
                </button>
              </div>
              <div className="botsq-card-body">
                <div className="botsq-master-row">
                  <label className="botsq-master-toggle">
                    <Switch
                      checked={!!overview?.enabled}
                      disabled={toggling}
                      onChange={toggleMaster}
                      label="Bot Squad ativado"
                    />
                    <span>
                      <strong>{overview?.enabled ? 'Bot Squad ativado' : 'Bot Squad desativado'}</strong>
                      <span className="botsq-master-toggle__hint">
                        Worker de hora em hora aposta nos jogos scheduled das próximas 7 dias
                      </span>
                    </span>
                  </label>
                  {overview?.league && (
                    <Link to={`/meus-grupos/${overview.league.id}`} className="btn btn-sm">
                      🍻 Ver liga {overview.league.name}
                    </Link>
                  )}
                </div>

                <div className="botsq-stats">
                  <div className="botsq-stat">
                    <span className="botsq-stat__icon">🎯</span>
                    <div>
                      <div className="botsq-stat__val">{stats.totalBets}</div>
                      <div className="botsq-stat__label">Apostas dos bots</div>
                    </div>
                  </div>
                  <div className="botsq-stat">
                    <span className="botsq-stat__icon">📅</span>
                    <div>
                      <div className="botsq-stat__val">{stats.betsToday}</div>
                      <div className="botsq-stat__label">Apostaram hoje</div>
                    </div>
                  </div>
                  <div className="botsq-stat">
                    <span className="botsq-stat__icon">✅</span>
                    <div>
                      <div className="botsq-stat__val">{stats.activePersonas}/{stats.total}</div>
                      <div className="botsq-stat__label">Personas ativas</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Card Revisão T-3h ─────────────────────────────────────── */}
            <div className="adm-card">
              <div className="adm-card__head">
                <span className="adm-card__title">⏱️ Revisão T-3h</span>
              </div>
              <div className="botsq-card-body">
                <div className="botsq-review-cols">
                  <div>
                    <div className="botsq-review-subtitle">Entram na janela (próximas 6h)</div>
                    {overview?.upcoming_reviews?.length ? (
                      <div className="botsq-review-list">
                        {overview.upcoming_reviews.map(m => (
                          <div key={m.match_id} className="botsq-review-item">
                            <span className="botsq-review-item__teams">{m.teams}</span>
                            <span className="botsq-review-item__meta">
                              {fmtTimeOnly(m.kickoff)} BRT · {m.bots_com_aposta} bot(s) já apostou
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="botsq-empty">Nenhum jogo entra na janela T-3h nas próximas 6h.</div>
                    )}
                  </div>
                  <div>
                    <div className="botsq-review-subtitle">Últimas revisões</div>
                    {overview?.recent_reviews?.length ? (
                      <div className="botsq-review-list">
                        {overview.recent_reviews.map(r => (
                          <div key={r.match_id} className="botsq-review-item">
                            <span className="botsq-review-item__teams">
                              {r.teams || `Jogo #${r.match_id}`}{r.telegram_sent ? ' ✈️' : ''}
                            </span>
                            <span className="botsq-review-item__meta">
                              {r.kept_count} mantiveram · {r.adjusted_count} ajustaram · {fmtDateTime(r.reviewed_at)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="botsq-empty">Nenhuma revisão T-3h rodou ainda.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Rodar agora (dry-run) ─────────────────────────────────── */}
            <div className="adm-card">
              <div className="adm-card__head">
                <span className="adm-card__title">▶ Rodar agora</span>
                <button className="btn btn-sm" onClick={runDryRun} disabled={running}>
                  {running ? 'Rodando…' : '▶ Rodar agora (dry-run)'}
                </button>
              </div>
              <div className="botsq-card-body">
                {!runResult && (
                  <div className="botsq-empty">
                    Simula o próximo tick do worker sem gravar nada — mostra quais jogos/personas estão prontos.
                  </div>
                )}
                {runResult && (
                  runResult.matches?.length ? (
                    <div className="botsq-run-list">
                      {runResult.matches.map(m => (
                        <div key={m.match_id} className="botsq-run-item">
                          <span className="botsq-run-item__teams">{m.teams}</span>
                          <span className="botsq-run-item__meta">
                            ✅ {m.personas_prontas?.length || 0} prontas · ⏳ {m.personas_jitter_futuro?.length || 0} aguardando jitter
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="botsq-empty">Nenhum jogo pendente na janela de 7 dias no momento.</div>
                  )
                )}
              </div>
            </div>

            {/* ── Grid de personas ──────────────────────────────────────── */}
            <div className="adm-card">
              <div className="adm-card__head">
                <span className="adm-card__title">👥 Personas ({overview?.personas?.length || 0})</span>
              </div>
              <div className="botsq-card-body">
                <div className="botsq-grid">
                  {overview?.personas?.map(p => {
                    const arch = archetypeMeta(p.archetype)
                    return (
                      <div
                        key={p.id}
                        className={`botsq-persona${p.enabled ? '' : ' botsq-persona--off'}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => openEdit(p)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openEdit(p) }}
                      >
                        <div className="botsq-persona__head">
                          <div className="botsq-persona__id">
                            <div className="botsq-persona__avatar" style={{ '--arch-hue': arch.hue }}>
                              {initials(p.name)}
                              {p.favorite_team_flag_url && (
                                <span className="botsq-persona__crest" title={p.favorite_team_name || p.favorite_team_code}>
                                  <TeamCrestFlag
                                    src={p.favorite_team_flag_url}
                                    alt={p.favorite_team_name || p.favorite_team_code}
                                    className="botsq-persona__crest-img"
                                    crestClassName="botsq-persona__crest-img--crest"
                                  />
                                </span>
                              )}
                            </div>
                            <div>
                              <div className="botsq-persona__name">{p.name}</div>
                              <div className="botsq-persona__username">@{p.username || '—'}</div>
                            </div>
                          </div>
                          <div onClick={e => e.stopPropagation()}>
                            <Switch checked={p.enabled} onChange={() => togglePersona(p)} label={`${p.name} ativa`} />
                          </div>
                        </div>
                        <div className="botsq-persona__badges">
                          <span className="badge badge-group botsq-persona__arch-badge" style={{ '--arch-hue': arch.hue }}>
                            {arch.icon} {arch.label}
                          </span>
                          {p.favorite_team_name ? (
                            <span className="badge badge-win">❤️ {p.favorite_team_name}</span>
                          ) : p.favorite_team_code ? (
                            <span className="badge badge-win">❤️ {p.favorite_team_code}</span>
                          ) : null}
                        </div>
                        <div className="botsq-persona__stats">
                          <span>{p.bets_total} apostas</span>
                          <span>{p.points_copa} pts Copa</span>
                          <span>{p.points_br} pts BR</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {editing && (
        <EditPersonaModal
          editing={editing}
          saving={saving}
          onClose={closeEdit}
          onSave={saveEdit}
          onField={setDraftField}
          onParam={setDraftParam}
        />
      )}
    </div>
  )
}

function EditPersonaModal({ editing, saving, onClose, onSave, onField, onParam }) {
  const { persona, draft } = editing
  const arch = archetypeMeta(persona.archetype)
  const draftCode = (draft.favorite_team_code || '').trim().toUpperCase()
  // escudo acompanha o código digitado enquanto ainda bate com o time original;
  // se o admin trocar o código, volta a mostrar sem crest até salvar (não inventa imagem)
  const crestSrc = draftCode && draftCode === (persona.favorite_team_code || '').toUpperCase()
    ? persona.favorite_team_flag_url
    : null

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return createPortal(
    <div className="botsq-modal-backdrop" onClick={onClose}>
      <div className="botsq-modal fade-in-1" onClick={e => e.stopPropagation()}>
        <div className="botsq-modal__header">
          <div className="botsq-modal__id">
            <div className="botsq-persona__avatar botsq-persona__avatar--lg" style={{ '--arch-hue': arch.hue }}>
              {initials(persona.name)}
              {crestSrc && (
                <span className="botsq-persona__crest botsq-persona__crest--lg">
                  <TeamCrestFlag
                    src={crestSrc}
                    alt={persona.favorite_team_name || draftCode}
                    className="botsq-persona__crest-img"
                    crestClassName="botsq-persona__crest-img--crest"
                  />
                </span>
              )}
            </div>
            <div>
              <div className="botsq-modal__title">{persona.name}</div>
              <div className="botsq-modal__sub">@{persona.username || '—'} · {arch.icon} {arch.label}</div>
            </div>
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose} disabled={saving}>✕</button>
        </div>

        <div className="botsq-modal__body">
          <div className="form-group">
            <label className="form-label">Bio</label>
            <textarea
              className="form-input" rows={3}
              value={draft.bio}
              onChange={e => onField('bio', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Time do coração (código)</label>
            <input
              className="form-input" style={{ maxWidth: 140 }} maxLength={6}
              placeholder="ex: FLA (vazio = nenhum)"
              value={draft.favorite_team_code}
              onChange={e => onField('favorite_team_code', e.target.value)}
            />
          </div>

          <div className="botsq-params">
            {PARAM_FIELDS.map(f => {
              const raw = draft.params?.[f.key]
              const value = raw === undefined || raw === null || Number.isNaN(Number(raw)) ? f.min : Number(raw)
              return (
                <div key={f.key} className="botsq-param-row">
                  <div className="botsq-param-row__label">
                    <span>{f.label}</span>
                    <span className="botsq-param-row__val">{f.integer ? Math.round(value) : value.toFixed(2)}</span>
                  </div>
                  <div className="botsq-param-row__controls">
                    <input
                      type="range" min={f.min} max={f.max} step={f.step}
                      value={value}
                      onChange={e => onParam(f.key, f.integer ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
                    />
                    <input
                      type="number" min={f.min} max={f.max} step={f.step}
                      className="botsq-param-row__number"
                      value={value}
                      onChange={e => {
                        const v = e.target.value === '' ? f.min : Number(e.target.value)
                        onParam(f.key, f.integer ? Math.round(v) : v)
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="botsq-modal__footer">
          <button className="btn-ghost btn-sm" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-sm" onClick={onSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
