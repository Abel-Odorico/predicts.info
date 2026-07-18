import TeamCrestFlag from './TeamCrestFlag'

export default function SimAnalysisCard({ analysis, teamA, teamB, show, onToggle }) {
  if (!analysis) return null
  const s = { fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }
  const h = { fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--accent)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }
  return (
    <div className="card" style={{ padding: 'var(--s4)' }}>
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
        cursor: 'pointer', padding: 0, fontFamily: 'var(--font-cond)', fontWeight: 700,
        fontSize: 15, color: 'var(--accent)', letterSpacing: '0.04em', width: '100%',
        justifyContent: 'space-between',
      }}>
        <span>🤖 Análise IA — {teamA?.code} × {teamB?.code}</span>
        <span style={{ fontSize: 12, color: 'var(--text-4)', fontWeight: 400 }}>{show ? '▲' : '▼'}</span>
      </button>

      {analysis.hook && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--accent-dim)', border: '1px solid var(--border-accent)', borderRadius: 8, fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>
          📊 {analysis.hook}
        </div>
      )}

      {analysis.verdict && (
        <div style={{ marginTop: 10, padding: '8px 14px', background: 'var(--accent-dim)', border: '1px solid var(--border-accent)', borderRadius: 8, fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>
          {analysis.verdict}
        </div>
      )}

      {show && (
        <div className="fade-in-1" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {analysis.overview && <div><div style={h}>📋 Panorama</div><div style={s}>{analysis.overview}</div></div>}

          {(analysis.team_a || analysis.team_b) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {[{ team: teamA, data: analysis.team_a }, { team: teamB, data: analysis.team_b }].map(({ team, data }) => data ? (
                <div key={team?.code} style={{ background: 'var(--bg-overlay)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)', minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    {team?.flag_url && (
                      <TeamCrestFlag
                        src={team.flag_url}
                        alt={team.code}
                        style={{ width: 28, height: 20, objectFit: 'cover', borderRadius: 2 }}
                        crestStyle={{ width: 26, height: 26, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }}
                      />
                    )}
                    <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{team?.name || team?.code}</span>
                  </div>
                  {data.tactical && <><div style={h}>Tática</div><div style={{ ...s, marginBottom: 8 }}>{data.tactical}</div></>}
                  {data.strengths && <><div style={h}>✅ Forças</div><div style={{ ...s, marginBottom: 8 }}>{data.strengths}</div></>}
                  {data.weaknesses && <><div style={h}>⚠️ Vulnerabilidades</div><div style={{ ...s, marginBottom: 8 }}>{data.weaknesses}</div></>}
                  {data.form && <><div style={h}>📈 Forma</div><div style={{ ...s, marginBottom: 8 }}>{data.form}</div></>}
                  {data.key_players?.length > 0 && (
                    <><div style={h}>⭐ Jogadores-chave</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {data.key_players.map((p, i) => <li key={i} style={{ ...s, marginBottom: 3 }}>{p}</li>)}
                    </ul></>
                  )}
                </div>
              ) : null)}
            </div>
          )}

          {analysis.matchup && <div><div style={h}>⚔️ Confronto</div><div style={s}>{analysis.matchup}</div></div>}
          {analysis.prediction && <div><div style={h}>🔮 Predição</div><div style={s}>{analysis.prediction}</div></div>}
        </div>
      )}
    </div>
  )
}
