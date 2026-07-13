import { useState } from 'react'

// Enquete só visual — sem persistência ainda.
// Integração futura: POST /polls/pos-copa/vote { option } (tabela a definir)
//
// O bloco "fase beta" NÃO tem CTA própria de cadastro — o card de waitlist
// (seção #avise-me, que grava de verdade em `competition_waitlist`) já cobre
// essa intenção. Duas caixas de "me avisa"/"quero entrar" lado a lado, uma
// real e uma que só fingia sucesso local, confundia e passava informação
// falsa pro usuário — por isso este CTA rola até a waitlist real.
export default function PollCard({ options, onWantBeta }) {
  const [picked, setPicked] = useState(null)

  return (
    <div className="pc-poll">
      <div className="pc-poll__card">
        <h3>Qual campeonato você quer ver primeiro no Predicts.info depois da Copa?</h3>
        <div className="pc-poll__options">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`pc-poll__option ${picked === opt ? 'pc-poll__option--picked' : ''}`}
              onClick={() => setPicked(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
        {picked && <p className="pc-poll__thanks">Valeu! Registramos seu voto em "{picked}" (localmente, por enquanto).</p>}
      </div>

      <div className="pc-poll__beta">
        <h3>Quer participar da fase beta?</h3>
        <p>Seja um dos primeiros a testar Brasileirão, Libertadores e Copa do Brasil no Predicts.</p>
        <button type="button" className="pc-btn pc-btn--primary" onClick={onWantBeta}>
          Entrar na lista de espera
        </button>
      </div>
    </div>
  )
}
