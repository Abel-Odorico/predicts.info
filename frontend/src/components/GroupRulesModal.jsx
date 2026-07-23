import { createPortal } from 'react-dom'

// Explica pra QUALQUER membro do grupo (não só dono) como funcionam as 4
// mecânicas extras do Brasileirão nesse bolão específico — com os valores
// REAIS configurados (não os defaults), pra não confundir quem só vê o
// resultado no ranking sem ter mexido na engrenagem.
export default function GroupRulesModal({ config, brTeams, onClose }) {
  const teamName = code => brTeams?.find(t => t.code === code)?.name || code
  const c = config || {}
  const cb = c.classification_bonus || {}
  const dm = c.double_match || {}
  const ln = c.lanterna || {}
  const mb = c.monthly_bonus || {}
  const anyEnabled = cb.enabled || dm.enabled || ln.enabled || mb.enabled

  return createPortal(
    <div className="pop-backdrop" onClick={onClose}>
      <div className="pop-card" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <button type="button" className="pop-close" onClick={onClose} aria-label="Fechar">✕</button>

        <div className="group-manager-card__kicker">Bolão · 🇧🇷 Brasileirão</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '2px 0 4px' }}>📖 Regras deste grupo</h2>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', margin: '0 0 var(--s4)' }}>
          Mecânicas extras valem só pro ranking do Brasileirão DENTRO deste bolão — não mexem no ranking Geral nem em outros grupos.
        </p>

        {!anyEnabled && (
          <div className="card" style={{ padding: 'var(--s4)', textAlign: 'center', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
            Nenhuma mecânica extra ativa neste grupo ainda. O dono pode ligar pela engrenagem ⚙️.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>

          <RuleBlock enabled={cb.enabled} accent="#e8a030" title="1. Bônus de Classificação" kicker="Mecânica 1">
            Antes do returno (2º turno) começar, cada participante manda a ordem prevista do 1º ao {c._teamCount || '20'}º colocado do Brasileirão nesse turno.
            No fim do campeonato, cada posição de time que bater exato vale <b>+{cb.pts_per_hit ?? 3} pt{(cb.pts_per_hit ?? 3) === 1 ? '' : 's'}</b>.
          </RuleBlock>

          <RuleBlock enabled={dm.enabled} accent="var(--accent)" title="2. Jogo em Dobro" kicker="Mecânica 2">
            Toda rodada, 1 jogo vale pontuação em dobro só pro ranking deste grupo. O dono escolhe manualmente pelo painel.
            {dm.auto_double_derbies?.length > 0 && (
              <>
                {' '}Exceção automática — se algum destes clássicos estiver escalado na rodada, ele já vira o jogo em dobro sozinho, sem precisar escolher:
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {dm.auto_double_derbies.map((pair, i) => (
                    <li key={i} style={{ fontSize: 12 }}>{teamName(pair[0])} × {teamName(pair[1])}</li>
                  ))}
                </ul>
              </>
            )}
          </RuleBlock>

          <RuleBlock enabled={ln.enabled} accent="var(--lose)" title="3. Lanterna da Rodada" kicker="Mecânica 3">
            Quem tira menos pontos na rodada (dentro do grupo) vira lanterna: grava vídeo de zueira pro grupo e paga <b>PIX de R$ {(ln.pix_value ?? 10).toFixed(2)}</b> pro fundo comum.
            Empate em tudo → todos os empatados viram lanterna (todos gravam, todos pagam).
            No fim do campeonato o fundo é dividido entre o top 3 do ranking geral do grupo: <b>{(ln.fund_split ?? [50, 30, 20]).join('% / ')}%</b>.
          </RuleBlock>

          <RuleBlock enabled={mb.enabled} accent="var(--win)" title="4. Bônus Mensal" kicker="Mecânica 4">
            Ranking do mês (soma de pontos do grupo naquele mês) premia:
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
              <li>🥇 1º: +{mb.pts_by_rank?.['1'] ?? 6} pts (crédito de {mb.credits_by_rank?.['1']?.pe ?? 2} PE)</li>
              <li>🥈 2º: +{mb.pts_by_rank?.['2'] ?? 3} pts (crédito de {mb.credits_by_rank?.['2']?.pe ?? 1} PE)</li>
              <li>🥉 3º: +{mb.pts_by_rank?.['3'] ?? 1} pt (crédito de {mb.credits_by_rank?.['3']?.ve ?? 1} VE)</li>
            </ul>
            PE = placar exato (cravou), VE = acerto de resultado. Créditos somam no desempate do ranking do grupo, sem contaminar o ranking Geral do site.
          </RuleBlock>

          <div className="card" style={{ padding: 'var(--s3) var(--s4)', background: 'var(--bg-overlay)' }}>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 4 }}>
              Critério de desempate (nessa ordem)
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)' }}>
              <li>Mais acertos no Bônus de Classificação</li>
              <li>Mais PE (placar exato, incl. crédito do Bônus Mensal)</li>
              <li>Mais VE (acerto de resultado, incl. crédito do Bônus Mensal)</li>
            </ol>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function RuleBlock({ enabled, accent, title, kicker, children }) {
  return (
    <div className="card" style={{ padding: 0, borderLeft: `3px solid ${accent}`, opacity: enabled ? 1 : 0.5 }}>
      <div style={{ padding: 'var(--s3) var(--s4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="group-manager-card__kicker">{kicker}</div>
          <span className="badge" style={{ fontSize: 10, background: enabled ? 'var(--win-dim)' : 'var(--bg-overlay)', color: enabled ? 'var(--win)' : 'var(--text-4)' }}>
            {enabled ? 'ativo' : 'inativo'}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>{title}</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  )
}
