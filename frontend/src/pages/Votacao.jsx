import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

const BASE_ROWS = [
  { resultado: 'Placar exato', pts: '25 pts', highlight: true },
  { resultado: 'Vencedor + gols do vencedor', pts: '18 pts', highlight: false },
  { resultado: 'Vencedor + saldo de gols', pts: '15 pts', highlight: false },
  { resultado: 'Vencedor + gols do perdedor', pts: '12 pts', highlight: false },
  { resultado: 'Apenas resultado certo', pts: '10 pts', highlight: false },
  { resultado: 'Nenhum acerto', pts: '0 pts', highlight: false },
]

const POSICAO_BONUS = [
  { label: 'Campeão certo (fim de temporada)', pts: '+150 pts' },
  { label: 'Vice certo (fim de temporada)', pts: '+75 pts' },
  { label: 'Cada time do G4 certo (até 4)', pts: '+25 pts cada' },
]

const SISTEMAS = [
  {
    key: 'posicao',
    label: 'Precisão + Posição Final',
    tag: 'OPÇÃO 1',
    tagColor: 'var(--accent)',
    desc: 'A pontuação por jogo de sempre, mais um palpite único de campeão/vice/G4 no fim da temporada.',
    rows: BASE_ROWS,
    bonus: POSICAO_BONUS,
  },
  {
    key: 'classico',
    label: 'Precisão + Clássico + Posição Final',
    tag: 'OPÇÃO 2',
    tagColor: '#9b5de8',
    desc: 'Mesma pontuação por jogo — em clássicos regionais (Fla-Flu, Grenal, Choque-Rei etc.) e na rodada que decide título/G4/rebaixamento, todos os pontos valem em dobro.',
    rows: BASE_ROWS,
    bonus: [
      { label: '🔥 Clássico ou rodada decisiva — todos os pontos do jogo em DOBRO', pts: '×2' },
      ...POSICAO_BONUS,
    ],
  },
  {
    key: 'zebra',
    label: 'Precisão + Zebra + Posição Final',
    tag: 'OPÇÃO 3',
    tagColor: '#e8935b',
    desc: 'Mesma pontuação por jogo — mais bônus quando você acerta o resultado com o time em desvantagem na tabela ou no Elo.',
    rows: BASE_ROWS,
    bonus: [
      { label: '🐴 Zebra — acertou com o time em desvantagem na tabela/Elo', pts: '+15 pts' },
      ...POSICAO_BONUS,
    ],
  },
]

const EXEMPLO = [
  { cenario: 'Fla-Flu — cravou o placar exato', posicao: '25 pts', classico: '50 pts', zebra: '25 pts' },
  { cenario: 'Fla-Flu — só acertou o vencedor', posicao: '10 pts', classico: '20 pts', zebra: '10 pts' },
  { cenario: 'Lanterna bate o líder — cravou o placar exato', posicao: '25 pts', classico: '25 pts', zebra: '40 pts' },
  { cenario: 'Lanterna bate o líder — só acertou o vencedor', posicao: '10 pts', classico: '10 pts', zebra: '25 pts' },
  { cenario: 'Campeão certo no palpite de fim de temporada', posicao: '+150 pts', classico: '+150 pts', zebra: '+150 pts' },
]

function Countdown({ closesAt }) {
  const [rem, setRem] = useState(null)

  useEffect(() => {
    function calc() {
      const diff = new Date(closesAt + 'Z') - Date.now()
      if (diff <= 0) { setRem(null); return }
      const d = Math.floor(diff / 86400000)
      const h = Math.floor((diff % 86400000) / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setRem({ d, h, m, s })
    }
    calc()
    const t = setInterval(calc, 1000)
    return () => clearInterval(t)
  }, [closesAt])

  if (!rem) return null
  return (
    <div className="poll-countdown">
      {rem.d > 0 && <span><b>{rem.d}</b>d</span>}
      <span><b>{String(rem.h).padStart(2, '0')}</b>h</span>
      <span><b>{String(rem.m).padStart(2, '0')}</b>m</span>
      <span><b>{String(rem.s).padStart(2, '0')}</b>s</span>
    </div>
  )
}

function ResultBar({ opt, total }) {
  return (
    <div className="poll-result-row">
      <div className="poll-result-label">{opt.label}</div>
      <div className="poll-result-track">
        <div
          className="poll-result-fill"
          style={{ width: `${opt.pct}%` }}
        />
      </div>
      <div className="poll-result-meta">
        <span className="poll-result-pct">{opt.pct}%</span>
        <span className="poll-result-count">{opt.count} voto{opt.count !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}

export default function Votacao() {
  const { user, token } = useAuth()
  const [poll, setPoll] = useState(null)
  const [myVote, setMyVote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedOption, setSelectedOption] = useState(null)
  const [suggestion, setSuggestion] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')
  const [sysTab, setSysTab] = useState('posicao')

  const load = useCallback(() => {
    const reqs = [api.get('/poll/active')]
    if (token) reqs.push(api.get('/poll/my-vote', token))
    Promise.all(reqs)
      .then(([p, v]) => {
        setPoll(p)
        if (v) {
          setMyVote(v)
          if (v.voted) {
            setSelectedOption(v.option_id)
            setSuggestion(v.suggestion || '')
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  async function handleVote(e) {
    e.preventDefault()
    if (!selectedOption) return
    setSubmitting(true)
    setMsg('')
    try {
      await api.post('/poll/vote', {
        option_id: selectedOption,
        suggestion: suggestion.trim() || null,
      }, token)
      setMsg('✓ Voto registrado com sucesso!')
      setMyVote({ voted: true, option_id: selectedOption, suggestion })
      load()
    } catch (err) {
      setMsg(`✗ ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  function fmtDate(dt) {
    if (!dt) return ''
    return new Date(dt + 'Z').toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="page">
        <div className="bet-empty fade-in-1">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  if (!poll) {
    return (
      <div className="page">
        <div className="bet-empty fade-in-1">
          <p className="page-subtitle">Nenhuma consulta ativa no momento.</p>
        </div>
      </div>
    )
  }

  const isOpen = poll.is_open
  const alreadyVoted = myVote?.voted
  const canChange = isOpen && alreadyVoted

  return (
    <div className="page poll-page fade-in-1">
      {/* ── Hero ─────────────────────────────────────── */}
      <div className="poll-hero">
        <div className="poll-hero__eyebrow">Consulta Oficial — Brasileirão</div>
        <h1 className="poll-hero__title">VOTAÇÃO: PONTUAÇÃO DO BRASILEIRÃO</h1>
        <p className="poll-hero__desc">{poll.description}</p>
        <div className="poll-urgency-note">
          ⚡ Se aprovada, a mudança vale a partir da próxima rodada não disputada.
          Rodadas já encerradas <strong>não serão recalculadas</strong>. O bônus de posição final
          (campeão/vice/G4) vale nas 3 opções e é um palpite único — trava antes da próxima rodada.
        </div>

        <div className="poll-hero__meta">
          <span className={`poll-status-badge ${isOpen ? 'open' : 'closed'}`}>
            {isOpen ? '🟢 Aberta' : '🔴 Encerrada'}
          </span>
          {isOpen && <Countdown closesAt={poll.closes_at} />}
          {!isOpen && poll.closed_at && (
            <span className="poll-hero__closed">
              Encerrada em {fmtDate(poll.closed_at)}
            </span>
          )}
        </div>

        <div className="poll-hero__stats">
          <div className="poll-stat">
            <span className="poll-stat__val">{poll.total_votes}</span>
            <span className="poll-stat__label">votos</span>
          </div>
          <div className="poll-stat">
            <span className="poll-stat__val">{poll.total_users}</span>
            <span className="poll-stat__label">participantes</span>
          </div>
          <div className="poll-stat">
            <span className="poll-stat__val">{poll.suggestion_count}</span>
            <span className="poll-stat__label">sugestões</span>
          </div>
          {poll.total_users > 0 && (
            <div className="poll-stat">
              <span className="poll-stat__val">
                {Math.round(poll.total_votes / poll.total_users * 100)}%
              </span>
              <span className="poll-stat__label">participação</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Sistemas ─────────────────────────────────── */}
      <section className="poll-section">
        <h2 className="poll-section__title">Os Sistemas em Comparação</h2>

        <div className="poll-sys-tabs">
          {SISTEMAS.map(s => (
            <button
              key={s.key}
              className={`poll-sys-tab ${sysTab === s.key ? 'active' : ''}`}
              onClick={() => setSysTab(s.key)}
              style={sysTab === s.key ? { borderColor: s.tagColor, color: s.tagColor } : {}}
            >
              {s.label}
            </button>
          ))}
        </div>

        {SISTEMAS.filter(s => s.key === sysTab).map(sys => (
          <div key={sys.key} className="poll-sys-card">
            <div className="poll-sys-card__header">
              <span className="poll-sys-tag" style={{ background: sys.tagColor + '22', color: sys.tagColor }}>
                {sys.tag}
              </span>
              <h3 className="poll-sys-card__name">{sys.label}</h3>
              <p className="poll-sys-card__desc">{sys.desc}</p>
            </div>

            <table className="poll-sys-table">
              <thead>
                <tr>
                  <th>Situação</th>
                  <th>Pontos</th>
                </tr>
              </thead>
              <tbody>
                {sys.rows.map((r, i) => (
                  <tr key={i} className={r.highlight ? 'highlight' : ''}>
                    <td>{r.resultado}</td>
                    <td className="pts">{r.pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {sys.bonus.length > 0 && (
              <div className="poll-sys-bonus">
                {sys.bonus.map((b, i) => (
                  <div key={i} className="poll-sys-bonus-row">
                    <span>{b.label}</span>
                    <span className="pts">{b.pts}</span>
                  </div>
                ))}
              </div>
            )}

            {sys.formula && (
              <div className="poll-sys-formula">
                <span className="poll-sys-formula__label">Fórmula:</span>
                <code>{sys.formula}</code>
              </div>
            )}
          </div>
        ))}

        {/* Tabela comparativa */}
        <details className="poll-compare-details">
          <summary>Ver tabela comparativa (cenários de exemplo)</summary>
          <div className="poll-compare-wrap">
            <table className="poll-compare-table">
              <thead>
                <tr>
                  <th>Cenário</th>
                  <th>Opção 1 — Posição</th>
                  <th>Opção 2 — Clássico</th>
                  <th>Opção 3 — Zebra</th>
                </tr>
              </thead>
              <tbody>
                {EXEMPLO.map((ex, i) => (
                  <tr key={i} className={i === 0 ? 'highlight' : ''}>
                    <td className="ex-label">{ex.cenario}</td>
                    <td>{ex.posicao}</td>
                    <td>{ex.classico}</td>
                    <td>{ex.zebra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* ── Formulário de voto ───────────────────────── */}
      <section className="poll-section">
        <h2 className="poll-section__title">
          {alreadyVoted ? 'Seu Voto' : 'Participar da Consulta'}
        </h2>

        {!user && (
          <div className="poll-login-prompt">
            <p>Faça login para registrar seu voto.</p>
            <Link to="/login" className="btn btn-primary">Entrar</Link>
          </div>
        )}

        {user && !isOpen && !alreadyVoted && (
          <div className="poll-closed-notice">
            Consulta encerrada. Você não votou durante o período.
          </div>
        )}

        {user && (isOpen || alreadyVoted) && (
          <form className="poll-form" onSubmit={handleVote}>
            {alreadyVoted && (
              <div className="poll-voted-notice">
                ✓ Você já votou.{canChange && ' Pode alterar até o encerramento.'}
              </div>
            )}

            <div className="poll-options">
              {poll.options.map(opt => (
                <label
                  key={opt.id}
                  className={`poll-option ${selectedOption === opt.id ? 'selected' : ''} ${!isOpen ? 'disabled' : ''}`}
                >
                  <input
                    type="radio"
                    name="option"
                    value={opt.id}
                    checked={selectedOption === opt.id}
                    onChange={() => isOpen && setSelectedOption(opt.id)}
                    disabled={!isOpen}
                  />
                  <span className="poll-option__radio" />
                  <span className="poll-option__label">{opt.label}</span>
                </label>
              ))}
            </div>

            {isOpen && (
              <>
                <div className="poll-suggestion">
                  <label className="poll-suggestion__label">
                    Deixe sua sugestão <span>(opcional, até 500 caracteres)</span>
                  </label>
                  <textarea
                    className="poll-suggestion__input"
                    rows={3}
                    maxLength={500}
                    placeholder="Tem alguma ideia ou comentário sobre o sistema de pontuação?"
                    value={suggestion}
                    onChange={e => setSuggestion(e.target.value)}
                  />
                  <div className="poll-suggestion__count">{suggestion.length}/500</div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-lg poll-submit"
                  disabled={!selectedOption || submitting}
                >
                  {submitting ? 'Enviando...' : alreadyVoted ? 'Alterar voto' : 'Enviar voto'}
                </button>
              </>
            )}

            {msg && (
              <div className={`poll-msg ${msg.startsWith('✓') ? 'success' : 'error'}`}>
                {msg}
              </div>
            )}
          </form>
        )}
      </section>

      {/* ── Resultados ──────────────────────────────── */}
      <section className="poll-section">
        <h2 className="poll-section__title">Resultados em Tempo Real</h2>
        <div className="poll-results-meta">
          <span>Abertura: {fmtDate(poll.opens_at)}</span>
          <span>Encerramento: {fmtDate(poll.closes_at)}</span>
        </div>

        {poll.total_votes === 0 ? (
          <p className="poll-no-votes">Nenhum voto registrado ainda.</p>
        ) : (
          <div className="poll-results">
            {poll.options.map(opt => (
              <ResultBar key={opt.id} opt={opt} total={poll.total_votes} />
            ))}
            <div className="poll-results-total">
              Total: <strong>{poll.total_votes}</strong> voto{poll.total_votes !== 1 ? 's' : ''}
              {' '}de <strong>{poll.total_users}</strong> participante{poll.total_users !== 1 ? 's' : ''}
            </div>
          </div>
        )}

        {poll.status === 'closed' && poll.report && (
          <div className="poll-report">
            <h3 className="poll-report__title">Relatório Final</h3>
            {poll.report.winner && (
              <p className="poll-report__winner">
                Opção vencedora: <strong>{poll.report.winner.label}</strong>
                {' '}({poll.report.winner.pct}%)
              </p>
            )}
            <p className="poll-report__note">
              {poll.report.suggestion_count} sugestões recebidas.
              Relatório gerado em{' '}
              {poll.report.generated_at
                ? new Date(poll.report.generated_at).toLocaleString('pt-BR')
                : '—'
              }.
            </p>
          </div>
        )}
      </section>

      {/* ── Transparência ───────────────────────────── */}
      <section className="poll-section poll-transparency">
        <h2 className="poll-section__title">Transparência</h2>
        <ul className="poll-transparency__list">
          <li>1 voto por usuário registrado</li>
          <li>Alteração permitida até o encerramento</li>
          <li>Histórico de alterações registrado</li>
          <li>Dados pessoais não divulgados publicamente</li>
          <li>Relatório final publicado ao encerrar</li>
        </ul>
        <p className="poll-transparency__note">
          Veja as regras completas do bolão em{' '}
          <Link to="/regras">predicts.info/regras</Link>.
        </p>
      </section>
    </div>
  )
}
