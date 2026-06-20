import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

const SISTEMAS = [
  {
    key: 'atual',
    label: 'Sistema Atual',
    tag: 'VIGENTE',
    tagColor: 'var(--text-3)',
    desc: 'Simples e direto. Apenas 2 níveis de pontuação.',
    rows: [
      { resultado: 'Placar exato', pts: '3 pts', highlight: true },
      { resultado: 'Vencedor / empate certo', pts: '1 pt', highlight: false },
      { resultado: 'Nenhum acerto', pts: '0 pts', highlight: false },
    ],
    bonus: [],
  },
  {
    key: 'precisao',
    label: 'Pontuação por Precisão',
    tag: 'PROPOSTO',
    tagColor: 'var(--accent)',
    desc: 'Recompensa quem acerta mais detalhes. 5 níveis de pontuação.',
    rows: [
      { resultado: 'Placar exato', pts: '25 pts', highlight: true },
      { resultado: 'Vencedor + gols do vencedor', pts: '18 pts', highlight: false },
      { resultado: 'Vencedor + saldo de gols', pts: '15 pts', highlight: false },
      { resultado: 'Vencedor + gols do perdedor', pts: '12 pts', highlight: false },
      { resultado: 'Apenas resultado certo', pts: '10 pts', highlight: false },
      { resultado: 'Nenhum acerto', pts: '0 pts', highlight: false },
    ],
    bonus: [
      { label: 'Bônus campeão', pts: '+100 pts' },
      { label: 'Bônus vice-campeão', pts: '+50 pts' },
    ],
  },
  {
    key: 'proximidade',
    label: 'Proximidade Inteligente',
    tag: 'SUGERIDO',
    tagColor: '#9b5de8',
    desc: 'Pontuação contínua pela distância do placar. Quanto mais perto, mais pontos.',
    rows: [
      { resultado: 'Placar exato', pts: '25 pts', highlight: true },
      { resultado: 'Resultado certo, dist. 1 gol', pts: '23 pts', highlight: false },
      { resultado: 'Resultado certo, dist. 2 gols', pts: '21 pts', highlight: false },
      { resultado: 'Resultado certo, dist. 3+ gols', pts: '10–19 pts', highlight: false },
      { resultado: 'Resultado errado', pts: '0 pts', highlight: false },
    ],
    bonus: [
      { label: 'Bônus campeão', pts: '+100 pts' },
      { label: 'Bônus vice-campeão', pts: '+50 pts' },
    ],
    formula: 'Pts = 10 (resultado) + max(0, 15 − distância × 2) + 5 (exato)',
  },
]

const EXEMPLO = [
  { palpite: '2 × 1', atual: '3 pts', precisao: '25 pts', proximidade: '25 pts', label: 'Exato' },
  { palpite: '2 × 0', atual: '1 pt', precisao: '18 pts', proximidade: '23 pts', label: 'Venc. + gols do venc.' },
  { palpite: '3 × 1', atual: '1 pt', precisao: '15 pts', proximidade: '23 pts', label: 'Venc. + saldo' },
  { palpite: '3 × 2', atual: '1 pt', precisao: '12 pts', proximidade: '21 pts', label: 'Venc. + gols do perd.' },
  { palpite: '1 × 0', atual: '1 pt', precisao: '10 pts', proximidade: '21 pts', label: 'Só resultado' },
  { palpite: '0 × 1', atual: '0 pts', precisao: '0 pts', proximidade: '0 pts', label: 'Errou tudo' },
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
  const [sysTab, setSysTab] = useState('precisao')

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
        <div className="poll-hero__eyebrow">Consulta Oficial — Copa 2026</div>
        <h1 className="poll-hero__title">VOTAÇÃO: SISTEMA DE PONTUAÇÃO</h1>
        <p className="poll-hero__desc">{poll.description}</p>
        <div className="poll-urgency-note">
          ⚡ Se aprovada, a mudança vale para as partidas ainda não realizadas deste campeonato.
          Palpites já feitos serão avaliados pelo novo sistema a partir da implementação.
          Partidas já encerradas <strong>não serão recalculadas</strong>.
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
          <summary>Ver tabela comparativa (resultado: Brasil 2 × 1 Argentina)</summary>
          <div className="poll-compare-wrap">
            <table className="poll-compare-table">
              <thead>
                <tr>
                  <th>Palpite</th>
                  <th>Situação</th>
                  <th>Atual</th>
                  <th>Precisão</th>
                  <th>Proximidade</th>
                </tr>
              </thead>
              <tbody>
                {EXEMPLO.map((ex, i) => (
                  <tr key={i} className={i === 0 ? 'highlight' : ''}>
                    <td><code>{ex.palpite}</code></td>
                    <td className="ex-label">{ex.label}</td>
                    <td>{ex.atual}</td>
                    <td>{ex.precisao}</td>
                    <td>{ex.proximidade}</td>
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
