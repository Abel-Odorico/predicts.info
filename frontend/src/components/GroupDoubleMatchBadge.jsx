import { useState, useEffect } from 'react'
import { api } from '../api'
import TeamCrestFlag from './TeamCrestFlag'
import CollapsibleSection from './CollapsibleSection'

// Badge "🔥 Vale dobro" (passo 15) — visível pra todos os membros, não só o dono.
// Mostra o jogo da rodada atual que vale pontuação em dobro no ranking do grupo.
export default function GroupDoubleMatchBadge({ groupId, token, currentRodada, brTeams }) {
  const [info, setInfo] = useState(null)

  useEffect(() => {
    if (!currentRodada) return
    api.get(`/user-groups/${groupId}/double-match?rodada=${currentRodada}`, token)
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [groupId, token, currentRodada])

  if (!info || !info.team_a_code || !info.team_b_code) return null

  const crestA = brTeams.find(t => t.code === info.team_a_code)?.flag_url
  const crestB = brTeams.find(t => t.code === info.team_b_code)?.flag_url
  const teaser = `${info.team_a} × ${info.team_b} · rodada ${currentRodada}`

  return (
    <CollapsibleSection kicker="Mecânica 2" title="🔥 Jogo em Dobro" teaser={teaser} accent="var(--lose)" defaultOpen>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: 'color-mix(in srgb, var(--lose) 16%, transparent)', color: 'var(--lose)', border: '1px solid color-mix(in srgb, var(--lose) 40%, transparent)', flexShrink: 0 }}>
          🔥 Vale dobro
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
          {crestA && <TeamCrestFlag src={crestA} alt={info.team_a_code} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 18, height: 18, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />}
          <span>{info.team_a}</span>
          <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>×</span>
          <span>{info.team_b}</span>
          {crestB && <TeamCrestFlag src={crestB} alt={info.team_b_code} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 18, height: 18, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />}
        </div>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>
          Rodada {currentRodada} · {info.is_auto ? 'clássico automático' : 'escolhido pelo dono'}
        </span>
      </div>
    </CollapsibleSection>
  )
}
