import { useState, useEffect } from 'react'
import { api } from '../api'
import { toast } from '../toast'

// Switch liga/desliga — mesmo padrão .llm-switch já usado no admin (Sistema/Bot Squad),
// reaproveitado aqui em vez de inventar checkbox cru.
function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`llm-switch${checked ? ' llm-switch--on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="llm-switch__knob" />
    </button>
  )
}

function Block({ kicker, title, children }) {
  return (
    <div className="card mt-3" style={{ padding: 'var(--s4)' }}>
      <div className="group-manager-card__kicker" style={{ marginBottom: 2 }}>{kicker}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, color: 'var(--text-1)', marginBottom: 'var(--s3)' }}>{title}</div>
      {children}
    </div>
  )
}

function NumField({ label, value, onChange, min = 0, step = 1, prefix, width = 90 }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="form-label" style={{ margin: 0 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {prefix && <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: 'var(--text-3)' }}>{prefix}</span>}
        <input
          type="number" className="form-input" style={{ width }}
          min={min} step={step} value={value}
          onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </div>
    </label>
  )
}

export default function GroupFeatureConfig({ groupId, token, config, onSaved, brTeams, currentRodada, onClose }) {
  const open = true // visibilidade agora é controlada pelo botão ⚙️ no cabeçalho do grupo (GroupRanking.jsx)

  // ── Cópias locais editáveis por bloco (seed do config do pai a cada troca) ──
  const [cls, setCls] = useState(config.classification_bonus)
  const [dbl, setDbl] = useState(config.double_match)
  const [lan, setLan] = useState(config.lanterna)
  const [mon, setMon] = useState(config.monthly_bonus)
  const [notif, setNotif] = useState(config.notifications_enabled)

  useEffect(() => { setCls(config.classification_bonus) }, [config.classification_bonus])
  useEffect(() => { setDbl(config.double_match) }, [config.double_match])
  useEffect(() => { setLan(config.lanterna) }, [config.lanterna])
  useEffect(() => { setMon(config.monthly_bonus) }, [config.monthly_bonus])
  useEffect(() => { setNotif(config.notifications_enabled) }, [config.notifications_enabled])

  const [savingBlock, setSavingBlock] = useState(null)

  async function saveBlock(key, patch) {
    setSavingBlock(key)
    try {
      const res = await api.patch(`/user-groups/${groupId}/feature-config`, { [key]: patch }, token)
      onSaved(res.config)
      toast.success('Configuração salva')
    } catch (e) {
      toast.error(e.message || 'Erro ao salvar')
    } finally {
      setSavingBlock(null)
    }
  }

  async function saveNotifications(v) {
    setNotif(v)
    await saveBlock('notifications_enabled', v)
  }

  // ── Clássicos automáticos (jogo em dobro) ──────────────────────
  const [derbyA, setDerbyA] = useState('')
  const [derbyB, setDerbyB] = useState('')

  function addDerby() {
    if (!derbyA || !derbyB || derbyA === derbyB) return
    const next = [...(dbl.auto_double_derbies || []), [derbyA, derbyB]]
    setDbl(d => ({ ...d, auto_double_derbies: next }))
    setDerbyA(''); setDerbyB('')
  }
  function removeDerby(idx) {
    const next = (dbl.auto_double_derbies || []).filter((_, i) => i !== idx)
    setDbl(d => ({ ...d, auto_double_derbies: next }))
  }

  // ── Escolha manual do jogo em dobro (rodada atual) ──────────────
  const [manualInfo, setManualInfo] = useState(null)
  const [rodadaMatches, setRodadaMatches] = useState([])
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [savingManual, setSavingManual] = useState(false)

  useEffect(() => {
    if (!open || !currentRodada) return
    api.get(`/user-groups/${groupId}/double-match?rodada=${currentRodada}`, token).then(setManualInfo).catch(() => setManualInfo(null))
    api.get(`/brasileirao/rodada?n=${currentRodada}`).then(r => setRodadaMatches(r?.matches ?? [])).catch(() => setRodadaMatches([]))
  }, [open, currentRodada, groupId, token])

  async function saveManualDouble() {
    if (!selectedMatchId) return
    setSavingManual(true)
    try {
      await api.post(`/user-groups/${groupId}/double-match`, { match_number: currentRodada, match_id: Number(selectedMatchId) }, token)
      const info = await api.get(`/user-groups/${groupId}/double-match?rodada=${currentRodada}`, token)
      setManualInfo(info)
      toast.success('Jogo em dobro definido')
    } catch (e) {
      toast.error(e.message || 'Erro ao salvar jogo em dobro')
    } finally {
      setSavingManual(false)
    }
  }

  const teamName = code => brTeams.find(t => t.code === code)?.name || code

  return (
    <div className="card mt-4 fade-in-1" style={{ padding: 0, borderLeft: '3px solid var(--accent)' }}>
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--s4)' }}>
        <div>
          <div className="group-manager-card__kicker" style={{ marginBottom: 2 }}>Área do dono</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, color: 'var(--text-1)' }}>⚙️ Mecânicas extras do bolão</div>
        </div>
        <button type="button" className="group-manager-card__icon-btn" onClick={onClose} title="Fechar" aria-label="Fechar configuração">
          ✕
        </button>
      </div>

      {/* ── Guia de competição — hoje só o Brasileirão tem mecânica própria; deixa */}
      {/* explícito onde essas 4 regras valem, já preparado pra outras entrarem depois. ── */}
      <div className="phase-nav" style={{ margin: '0 var(--s4) var(--s3)' }}>
        <button type="button" className="phase-nav__tab active" disabled>🇧🇷 Brasileirão</button>
      </div>
      <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', margin: '0 var(--s4) var(--s3)' }}>
        Essas 4 mecânicas valem só pro Brasileirão — Copa 2026 e o ranking Geral não são afetados.
      </p>

      {open && (
        <div style={{ padding: '0 var(--s4) var(--s4)' }}>

          {/* ── Notificações automáticas ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--s2) 0', borderBottom: '1px solid var(--border)', marginBottom: 'var(--s2)' }}>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)' }}>🔔 Notificar sino/WhatsApp quando alguma mecânica disparar (lanterna, dobro, mensal)</span>
            <Switch checked={!!notif} label="Notificações das mecânicas" onChange={saveNotifications} />
          </div>

          {/* ── 1. Bônus de classificação ── */}
          <Block kicker="Mecânica 1" title="🏆 Bônus de Classificação (returno)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--s3)' }}>
              <Switch checked={!!cls.enabled} label="Ativar bônus de classificação" onChange={v => setCls(c => ({ ...c, enabled: v }))} />
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)' }}>{cls.enabled ? 'Ativado' : 'Desativado'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <NumField label="Pontos por posição batida" value={cls.pts_per_hit} onChange={v => setCls(c => ({ ...c, pts_per_hit: v }))} />
              <button type="button" className="btn btn-primary btn-sm" disabled={savingBlock === 'classification_bonus'}
                onClick={() => saveBlock('classification_bonus', { enabled: cls.enabled, pts_per_hit: Number(cls.pts_per_hit) || 0 })}>
                {savingBlock === 'classification_bonus' ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
            <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', margin: 'var(--s2) 0 0' }}>
              Membro palpita a ordem final 1º–20º do returno antes da rodada 20. Acertos só contam quando o Brasileirão fechar.
            </p>
          </Block>

          {/* ── 2. Jogo em dobro ── */}
          <Block kicker="Mecânica 2" title="🔥 Jogo em Dobro">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--s3)' }}>
              <Switch checked={!!dbl.enabled} label="Ativar jogo em dobro" onChange={v => setDbl(c => ({ ...c, enabled: v }))} />
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)' }}>{dbl.enabled ? 'Ativado' : 'Desativado'}</span>
              <button type="button" className="btn btn-primary btn-sm" disabled={savingBlock === 'double_match'} style={{ marginLeft: 'auto' }}
                onClick={() => saveBlock('double_match', { enabled: dbl.enabled })}>
                {savingBlock === 'double_match' ? 'Salvando…' : 'Salvar ligar/desligar'}
              </button>
            </div>

            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
              Clássicos automáticos (1º da lista que cair na rodada vale dobro)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {(dbl.auto_double_derbies || []).map(([a, b], idx) => (
                <div key={`${a}-${b}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--bg-overlay)' }}>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', width: 18 }}>{idx + 1}º</span>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>{teamName(a)} × {teamName(b)}</span>
                  <button type="button" onClick={() => removeDerby(idx)} style={{ background: 'none', border: 'none', color: 'var(--lose)', cursor: 'pointer', fontSize: 14 }} title="Remover">✕</button>
                </div>
              ))}
              {(dbl.auto_double_derbies || []).length === 0 && (
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>Nenhum clássico configurado.</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <select className="form-input" style={{ width: 160 }} value={derbyA} onChange={e => setDerbyA(e.target.value)}>
                <option value="">Time A</option>
                {brTeams.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
              <span style={{ color: 'var(--text-3)' }}>×</span>
              <select className="form-input" style={{ width: 160 }} value={derbyB} onChange={e => setDerbyB(e.target.value)}>
                <option value="">Time B</option>
                {brTeams.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addDerby} disabled={!derbyA || !derbyB}>+ Adicionar</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={savingBlock === 'double_match'}
                onClick={() => saveBlock('double_match', { auto_double_derbies: dbl.auto_double_derbies })}>
                {savingBlock === 'double_match' ? 'Salvando…' : 'Salvar lista'}
              </button>
            </div>

            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', margin: '10px 0 6px' }}>
              Escolha manual — Rodada {currentRodada ?? '–'}
            </div>
            {manualInfo?.is_auto ? (
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>
                🔒 Definido automaticamente por clássico: <strong>{manualInfo.team_a_code} × {manualInfo.team_b_code}</strong> — escolha manual desabilitada pra esta rodada.
              </p>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="form-input" style={{ width: 260 }} value={selectedMatchId} onChange={e => setSelectedMatchId(e.target.value)}>
                  <option value="">{rodadaMatches.length ? 'Selecionar jogo…' : 'Sem jogos carregados'}</option>
                  {rodadaMatches.map(m => (
                    <option key={m.id} value={m.id}>{m.team_a?.name} × {m.team_b?.name}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-primary btn-sm" disabled={!selectedMatchId || savingManual} onClick={saveManualDouble}>
                  {savingManual ? 'Salvando…' : 'Marcar como dobro'}
                </button>
                {manualInfo?.match_id && !manualInfo.is_auto && (
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>
                    Atual: {manualInfo.team_a_code} × {manualInfo.team_b_code}
                  </span>
                )}
              </div>
            )}
          </Block>

          {/* ── 3. Lanterna ── */}
          <Block kicker="Mecânica 3" title="🔴 Lanterna da Rodada">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--s3)' }}>
              <Switch checked={!!lan.enabled} label="Ativar lanterna" onChange={v => setLan(c => ({ ...c, enabled: v }))} />
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)' }}>{lan.enabled ? 'Ativado' : 'Desativado'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <NumField label="Valor do PIX" value={lan.pix_value} onChange={v => setLan(c => ({ ...c, pix_value: v }))} prefix="R$" step={0.5} />
              <NumField label="Split 1º" value={lan.fund_split?.[0] ?? 0} onChange={v => setLan(c => ({ ...c, fund_split: [Number(v) || 0, c.fund_split?.[1] ?? 0, c.fund_split?.[2] ?? 0] }))} prefix="%" width={70} />
              <NumField label="Split 2º" value={lan.fund_split?.[1] ?? 0} onChange={v => setLan(c => ({ ...c, fund_split: [c.fund_split?.[0] ?? 0, Number(v) || 0, c.fund_split?.[2] ?? 0] }))} prefix="%" width={70} />
              <NumField label="Split 3º" value={lan.fund_split?.[2] ?? 0} onChange={v => setLan(c => ({ ...c, fund_split: [c.fund_split?.[0] ?? 0, c.fund_split?.[1] ?? 0, Number(v) || 0] }))} prefix="%" width={70} />
              <button type="button" className="btn btn-primary btn-sm" disabled={savingBlock === 'lanterna'}
                onClick={() => saveBlock('lanterna', { enabled: lan.enabled, pix_value: Number(lan.pix_value) || 0, fund_split: (lan.fund_split || [50, 30, 20]).map(n => Number(n) || 0) })}>
                {savingBlock === 'lanterna' ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
            <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', margin: 'var(--s2) 0 0' }}>
              Quem tira menos pontos na rodada paga o PIX pro fundo; fundo é dividido no fim entre o top 3 do ranking geral do grupo.
            </p>
          </Block>

          {/* ── 4. Bônus mensal ── */}
          <Block kicker="Mecânica 4" title="📅 Bônus Mensal">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--s3)' }}>
              <Switch checked={!!mon.enabled} label="Ativar bônus mensal" onChange={v => setMon(c => ({ ...c, enabled: v }))} />
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)' }}>{mon.enabled ? 'Ativado' : 'Desativado'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3].map(rank => {
                const key = String(rank)
                const creditObj = mon.credits_by_rank?.[key] || {}
                const creditType = Object.keys(creditObj)[0] || 'pe'
                const creditVal = creditObj[creditType] ?? 0
                return (
                  <div key={rank} style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderBottom: rank < 3 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)', width: 24 }}>{rank}º</span>
                    <NumField label="Pontos" value={mon.pts_by_rank?.[key] ?? 0} width={64}
                      onChange={v => setMon(c => ({ ...c, pts_by_rank: { ...c.pts_by_rank, [key]: Number(v) || 0 } }))} />
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span className="form-label" style={{ margin: 0 }}>Crédito</span>
                      <select className="form-input" style={{ width: 130 }} value={creditType}
                        onChange={e => setMon(c => ({ ...c, credits_by_rank: { ...c.credits_by_rank, [key]: { [e.target.value]: creditVal } } }))}>
                        <option value="pe">PE (cravada)</option>
                        <option value="ve">VE (acerto)</option>
                      </select>
                    </label>
                    <NumField label="Qtd." value={creditVal} width={64}
                      onChange={v => setMon(c => ({ ...c, credits_by_rank: { ...c.credits_by_rank, [key]: { [creditType]: Number(v) || 0 } } }))} />
                  </div>
                )
              })}
              <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} disabled={savingBlock === 'monthly_bonus'}
                onClick={() => saveBlock('monthly_bonus', { enabled: mon.enabled, pts_by_rank: mon.pts_by_rank, credits_by_rank: mon.credits_by_rank })}>
                {savingBlock === 'monthly_bonus' ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
            <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', margin: 'var(--s2) 0 0' }}>
              Fecha automaticamente no dia 1 de cada mês (cron), sobre o mês calendário anterior (fuso BRT).
            </p>
          </Block>

        </div>
      )}
    </div>
  )
}
