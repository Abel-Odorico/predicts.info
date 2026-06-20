import { Link } from 'react-router-dom'

const VERSAO = '1.0'
const VIGENCIA = '20/06/2026'

export default function Regras() {
  return (
    <div className="page regras-page fade-in-1">
      <div className="regras-hero">
        <div className="regras-hero__eyebrow">Documento Oficial</div>
        <h1 className="regras-hero__title">REGRAS DO BOLÃO</h1>
        <div className="regras-meta">
          <span>Versão {VERSAO}</span>
          <span>•</span>
          <span>Vigente desde {VIGENCIA}</span>
        </div>
      </div>

      {/* ── Sistema de Pontuação ─────────────────────── */}
      <section className="regras-section">
        <h2 className="regras-section__title">1. Sistema de Pontuação</h2>
        <p className="regras-section__desc">
          O sistema atual é simples: você é recompensado por acertar o resultado ou o placar exato.
        </p>
        <div className="regras-alert">
          🗳 <strong>Consulta ativa:</strong> um novo sistema está em votação e, se aprovado,
          entrará em vigor ainda neste campeonato (Copa 2026) para as partidas ainda não realizadas.
          Partidas já encerradas não serão recalculadas.{' '}
          <Link to="/votacao">Participe da votação</Link>.
        </div>

        <div className="regras-table-wrap">
          <table className="regras-table">
            <thead>
              <tr>
                <th>Situação</th>
                <th>Pontos</th>
                <th>Exemplo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="highlight">
                <td>Placar exato</td>
                <td className="pts">3 pts</td>
                <td className="ex">Resultado 2×1 · Palpite 2×1</td>
              </tr>
              <tr>
                <td>Acertou vencedor ou empate</td>
                <td className="pts">1 pt</td>
                <td className="ex">Resultado 2×1 · Palpite 3×0</td>
              </tr>
              <tr>
                <td>Nenhum acerto</td>
                <td className="pts">0 pts</td>
                <td className="ex">Resultado 2×1 · Palpite 0×2</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Palpite de Campeão e Vice ────────────────── */}
      <section className="regras-section">
        <h2 className="regras-section__title">2. Campeão e Vice-Campeão</h2>
        <ul className="regras-list">
          <li>Cada participante pode indicar um palpite de campeão e vice-campeão.</li>
          <li>
            <strong>Prazo:</strong> os palpites são bloqueados automaticamente 1 minuto
            antes do início da primeira partida oficial do campeonato.
          </li>
          <li>Após o bloqueio, nenhuma alteração é permitida.</li>
          <li>Acertar o campeão: <strong className="pts">+100 pontos</strong> (no novo sistema).</li>
          <li>Acertar o vice-campeão: <strong className="pts">+50 pontos</strong> (no novo sistema).</li>
          <li>No sistema atual, não há bônus de campeão/vice.</li>
        </ul>
      </section>

      {/* ── Prazo de Apostas ─────────────────────────── */}
      <section className="regras-section">
        <h2 className="regras-section__title">3. Prazo para Palpites</h2>
        <ul className="regras-list">
          <li>Cada partida tem prazo de palpite definido individualmente.</li>
          <li>O padrão é o horário de início da partida.</li>
          <li>Após o prazo, não é possível criar ou alterar palpites para aquela partida.</li>
          <li>Palpites feitos antes do prazo são válidos mesmo que sejam alterados antes do bloqueio.</li>
        </ul>
      </section>

      {/* ── Critérios de Desempate ───────────────────── */}
      <section className="regras-section">
        <h2 className="regras-section__title">4. Critérios de Desempate</h2>
        <p className="regras-section__desc">
          Em caso de empate no ranking, os critérios são aplicados nesta ordem:
        </p>
        <ol className="regras-list ordered">
          <li>Maior número de placares exatos</li>
          <li>Maior número de resultados corretos (vencedor/empate)</li>
          <li>Maior número de palpites realizados</li>
          <li>Ordem alfabética do nome</li>
        </ol>
      </section>

      {/* ── Grupos Privados ──────────────────────────── */}
      <section className="regras-section">
        <h2 className="regras-section__title">5. Grupos Privados</h2>
        <ul className="regras-list">
          <li>Qualquer participante pode criar um grupo privado.</li>
          <li>O criador é o administrador do grupo.</li>
          <li>Novos membros entram via link de convite.</li>
          <li>O ranking do grupo considera apenas os membros cadastrados nele.</li>
          <li>Os palpites são compartilhados (todos veem os palpites de todos no mesmo grupo).</li>
        </ul>
      </section>

      {/* ── Integridade ──────────────────────────────── */}
      <section className="regras-section">
        <h2 className="regras-section__title">6. Integridade e Auditoria</h2>
        <ul className="regras-list">
          <li>Os resultados oficiais são obtidos via API automaticamente após cada partida.</li>
          <li>Pontuações são recalculadas imediatamente após lançamento do resultado.</li>
          <li>Em caso de divergência, prevalece o resultado da fonte oficial da competição.</li>
          <li>Tentativas de manipulação resultam em exclusão do bolão.</li>
        </ul>
      </section>

      {/* ── Alterações de Regras ─────────────────────── */}
      <section className="regras-section">
        <h2 className="regras-section__title">7. Alterações de Regras</h2>
        <p className="regras-section__desc">
          Alterações nas regras de pontuação são submetidas à consulta pública antes de entrar em vigor.
          Veja a consulta ativa em <Link to="/votacao">/votacao</Link>.
          Toda nova versão das regras substitui integralmente a anterior e é publicada nesta página.
        </p>

        <div className="regras-history">
          <h3 className="regras-history__title">Histórico de Versões</h3>
          <table className="regras-table regras-history__table">
            <thead>
              <tr>
                <th>Versão</th>
                <th>Data</th>
                <th>Alteração</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1.0</td>
                <td>20/06/2026</td>
                <td>Versão inicial publicada</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────── */}
      <section className="regras-section">
        <h2 className="regras-section__title">Perguntas Frequentes</h2>
        <div className="regras-faq">
          {[
            {
              q: 'Posso alterar meu palpite depois de enviado?',
              a: 'Sim, até o prazo de bloqueio da partida (normalmente o horário de início).',
            },
            {
              q: 'O que acontece se eu esquecer de dar um palpite?',
              a: 'Você fica com 0 pontos naquela partida. Não há penalidade adicional.',
            },
            {
              q: 'Posso participar de mais de um grupo?',
              a: 'Sim, sem limite de grupos. Seu palpite é o mesmo em todos.',
            },
            {
              q: 'Quando os pontos são calculados?',
              a: 'Automaticamente após o lançamento do resultado oficial de cada partida.',
            },
            {
              q: 'A consulta de pontuação é obrigatória?',
              a: 'Não — é voluntária. Mas sua participação ajuda a decidir o futuro do bolão.',
            },
          ].map((item, i) => (
            <details key={i} className="regras-faq__item">
              <summary className="regras-faq__q">{item.q}</summary>
              <p className="regras-faq__a">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="regras-footer">
        <Link to="/votacao" className="btn btn-primary">Ver consulta de pontuação</Link>
        <Link to="/apostas" className="btn btn-ghost">Fazer palpites</Link>
      </div>
    </div>
  )
}
