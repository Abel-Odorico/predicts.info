import { Link } from 'react-router-dom'

const TEAMS = [
  {
    code: 'ARG',
    name: 'Argentina',
    flag: '🇦🇷',
    chave: 'Chave 2 — enfrenta a Inglaterra em 15/07',
    stats: { titulos: 3, aparicoes: 19, jogos: 90, vitorias: 49, semifinais: '6 finais disputadas' },
    photo: {
      src: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Maradona-Mundial_86_con_la_copa.JPG',
      alt: 'Diego Maradona ergue a taça da Copa do Mundo de 1986, no Azteca',
      credit: 'El Gráfico, 1986 · Domínio público',
    },
    intro: 'A Argentina é a seleção sul-americana com a segunda maior quantidade de finais de Copa do Mundo disputadas, atrás apenas do Brasil: seis, com três taças erguidas em quase meio século de intervalo entre a primeira e a última.',
    paragraphs: [
      'A história começou já na primeira Copa da história, em 1930, no Uruguai, quando a Argentina chegou à final e perdeu para o anfitrião. Precisou de 48 anos para reverter o roteiro: em 1978, jogando em casa, sob um clima político tenso da ditadura militar, a seleção de César Luis Menotti venceu a Holanda por 3 a 1 na prorrogação. Mario Kempes foi artilheiro e melhor jogador do torneio; Daniel Passarella, aos 25 anos, ergueu a taça como o capitão mais jovem da história a fazer isso.',
      'Oito anos depois, no México, veio a campanha mais lembrada do país: Diego Maradona jogou praticamente sozinho contra o mundo, participando direta ou indiretamente de 10 dos 14 gols argentinos no torneio. A Alemanha Ocidental foi batida por 3 a 2 na final, mas o jogo que entrou para a lenda foi antes, nas quartas — contra a própria Inglaterra, adversária desta semifinal de 2026.',
      'Depois de perder mais uma final em 1990 (para a Alemanha) e em 2014 (para a Alemanha novamente, desta vez no tempo de Messi), a Argentina finalmente fechou a conta em 2022, no Catar: campeã nos pênaltis sobre a França, em uma decisão que muitos consideram a melhor final da história da competição.',
    ],
    momento: {
      ano: '22 de junho de 1986 · Quartas de final vs. Inglaterra',
      photo: {
        src: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Maradona_shilton_mano_dios.jpg',
        alt: 'Maradona salta com o punho fechado por cima do goleiro Peter Shilton, no lance do gol de mão contra a Inglaterra em 1986',
        credit: 'El Gráfico, 22 de junho de 1986 · Domínio público',
      },
      texto: '"Um pouco com a cabeça de Maradona, um pouco com a mão de Deus." Maradona resolveu o jogo em menos de cinco minutos, com dois gols de outro planeta. No primeiro, subiu mais que o goleiro inglês Peter Shilton e desviou a bola de punho fechado — o árbitro tunisiano Ali Bin Nasser não viu nada, e o gol ficou de pé. Hoje bastaria meio minuto de VAR pra anular o lance; em 1986 essa tecnologia nem existia no papel, e a irregularidade entrou pra história em vez do banco de vídeo. Quatro minutos depois veio a resposta: Maradona catou a bola ainda no meio-campo, driblou cinco ingleses em sequência e bateu no canto — o "Gol do Século". Argentina venceu por 2 a 1 e seguiu rumo ao título.',
    },
    protagonist: {
      nome: 'Maradona & Messi',
      papel: 'os dois ícones que dividem as 3 estrelas',
      photo: {
        src: 'https://upload.wikimedia.org/wikipedia/commons/5/52/Lionel_Messi_playing_in_Argentina_2022_FIFA_World_Cup.jpg',
        alt: 'Lionel Messi em ação pela Argentina na Copa do Mundo de 2022',
        credit: 'Hossein Zohrevand / Tasnim News Agency, 2022 · CC BY 4.0',
      },
      bio: 'Trinta e seis anos separam o título de Maradona (1986) do de Messi (2022) — os dois maiores nomes da história do futebol argentino, cada um carregando a seleção nas costas em sua geração. Messi, que havia perdido a final de 2014, se tornou campeão mundial aos 35 anos, na provável última Copa da carreira, coroando uma trajetória que muitos consideravam incompleta sem essa taça.',
    },
    curiosidades: [
      'Maradona e Messi dividem o posto de maiores ídolos do país com 36 anos de intervalo entre seus títulos mundiais.',
      'A Argentina é a seleção sul-americana com a segunda maior quantidade de finais de Copa disputadas, atrás do Brasil: 6, vencendo 3.',
      'Argentina e Brasil são as únicas seleções sul-americanas a já ter vencido uma Copa fora das Américas — a Argentina no Catar (2022), o Brasil no Japão/Coreia do Sul (2002).',
    ],
  },
  {
    code: 'ENG',
    name: 'Inglaterra',
    flag: '🏴',
    chave: 'Chave 2 — enfrenta a Argentina em 15/07',
    stats: { titulos: 1, aparicoes: 17, jogos: 78, vitorias: 35, semifinais: '4 semifinais (1966, 1990, 2018, 2026)' },
    photo: {
      src: 'https://upload.wikimedia.org/wikipedia/commons/7/7a/England_vs_germany_hurst_heads_to_goal.jpg',
      alt: 'Lance da final de 1966 entre Inglaterra e Alemanha Ocidental em Wembley',
      credit: 'El Gráfico, 1966 · Domínio público',
    },
    intro: 'A Inglaterra inventou o futebol moderno mas levou 103 anos — contados da fundação da própria federação, em 1863 — pra ganhar uma Copa. E só ganhou essa uma. Ainda assim, é uma das histórias mais estudadas do esporte.',
    paragraphs: [
      'O único título inglês veio em 1966, jogando em casa. Sob o comando do técnico Alf Ramsey — que prometera publicamente a taça antes mesmo do torneio começar — a Inglaterra chegou à final contra a Alemanha Ocidental em Wembley. O jogo terminou 4 a 2 depois da prorrogação, decidido por um hat-trick histórico de Geoff Hurst: até hoje o único marcado numa final que terminou em título (Mbappé repetiria a proeza em 2022, mas perdendo). O terceiro gol de Hurst é discutido até hoje: câmeras da época não conseguiram provar com certeza se a bola cruzou inteira a linha do gol.',
      'Depois de 1966, a Inglaterra viveu décadas de frustração — eliminações precoces, brigas internas, e uma ausência total de duas Copas seguidas nos anos 1970 por não conseguir se classificar. A reaproximação de um resultado histórico só veio em 1990, na Itália, com uma geração liderada por Gary Lineker e Paul Gascoigne, parando nas semifinais contra a Alemanha Ocidental nos pênaltis — partida que ficou marcada pelas lágrimas de "Gazza" ao levar o segundo cartão amarelo do torneio.',
      'A história recente trouxe mais duas semifinais: em 2018, na Rússia, com Harry Kane artilheiro, parando diante da Croácia; e a atual, em 2026, contra a própria Argentina — reencontro de duas seleções cuja rivalidade nasceu muito antes de qualquer uma pisar num gramado de Copa, na Guerra das Malvinas de 1982.',
    ],
    momento: {
      ano: '30 de julho de 1966 · Final vs. Alemanha Ocidental',
      texto: 'Aos 101 minutos de prorrogação, com o placar em 2 a 2, Geoff Hurst bateu de primeira e viu a bola quicar no travessão, cair perto da linha e voltar pro campo. O árbitro suíço Gottfried Dienst ficou em dúvida e foi consultar o bandeirinha soviético Tofiq Bahramov — que confirmou: gol, 3 a 2. Se a bola cruzou a linha inteira é discutido até hoje; reconstituições feitas décadas depois com tecnologia moderna dão razão à Alemanha. Nos minutos finais, já com torcedores invadindo o campo por engano, Hurst bateu de novo e fechou o hat-trick — o gol da narração mais famosa da TV inglesa, "they think it\'s all over... it is now". Bobby Moore ergueu a taça Jules Rimet como capitão, limpando as mãos sujas de grama antes de cumprimentar a Rainha Elizabeth II.',
    },
    protagonist: {
      nome: 'Bobby Moore & Geoff Hurst',
      papel: 'o capitão e o autor do único hat-trick de uma final',
      photo: {
        src: 'https://upload.wikimedia.org/wikipedia/commons/2/26/England_germany_entering_pitch.jpg',
        alt: 'Bobby Moore lidera a seleção inglesa em campo na final de 1966',
        credit: 'El Gráfico, 1966 · Domínio público',
      },
      bio: 'Bobby Moore, zagueiro e capitão, é até hoje tratado como um dos maiores líderes que o futebol já teve — Pelé o descreveu como o melhor marcador contra quem já jogou. Geoff Hurst, atacante do West Ham, nem era titular absoluto: entrou no time durante o próprio Mundial, no lugar de Jimmy Greaves, machucado na fase de grupos, e saiu da Copa como o primeiro homem da história a marcar três gols numa final — proeza que só teria companhia 56 anos depois, com Mbappé em 2022, embora a França daquela vez tenha perdido.',
    },
    curiosidades: [
      'Geoff Hurst é o único jogador da história a marcar hat-trick numa final de Copa do Mundo e sair campeão com ela, em 1966. Mbappé repetiria o feito em 2022 — mas perdendo.',
      'Meses antes do início do torneio de 1966, a taça Jules Rimet foi roubada de uma exposição em Londres — recuperada dias depois por um cão chamado Pickles, que farejou um embrulho de jornal jogado numa rua.',
      'A Inglaterra levou 24 anos entre suas duas primeiras semifinais de Copa (1966 e 1990) e mais 28 até a terceira, em 2018.',
    ],
  },
  {
    code: 'FRA',
    name: 'França',
    flag: '🇫🇷',
    chave: 'Chave 1 — enfrenta a Espanha em 14/07',
    stats: { titulos: 2, aparicoes: 17, jogos: 60, vitorias: 36, semifinais: '4 finais em 28 anos (1998–2026)' },
    photo: {
      src: 'https://upload.wikimedia.org/wikipedia/commons/9/97/France_champion_of_the_Football_World_Cup_Russia_2018_%28cropped%29.jpg',
      alt: 'Seleção francesa celebra o título da Copa do Mundo de 2018',
      credit: 'Kremlin.ru, 2018 · CC BY 4.0',
    },
    intro: 'Depois de décadas como seleção respeitada mas sem taças, a França se tornou, em 20 anos, a equipe europeia mais presente em finais de Copa do Mundo do século 21: quatro decisões entre 1998 e 2022.',
    paragraphs: [
      'O primeiro título veio em casa, em 1998, encerrando quase oito décadas de espera desde a fundação da federação francesa, em 1919. Contra o Brasil, bicampeão e favorito, a França venceu por 3 a 0 com dois gols de cabeça de Zinedine Zidane e um de Emmanuel Petit nos acréscimos — resultado que abriu uma década de ouro para o futebol do país, incluindo o título da Eurocopa dois anos depois.',
      'Zidane também protagonizou a maior frustração francesa: em 2006, na sua última partida como jogador, foi expulso na prorrogação da final contra a Itália por dar uma cabeçada no italiano Marco Materazzi, depois de uma provocação. A França perdeu nos pênaltis, encerrando a carreira do maior ídolo francês da geração com essa imagem em vez de uma taça.',
      'A segunda estrela veio em 2018, na Rússia, com Kylian Mbappé, então com 19 anos, se tornando o primeiro adolescente a marcar numa final de Copa desde Pelé, em 1958. A vitória por 4 a 2 sobre a Croácia também tornou Didier Deschamps — capitão campeão em 1998 e técnico campeão em 2018 — apenas o terceiro homem da história a vencer a Copa como jogador e como treinador. Em 2022, a França voltou à final, perdeu nos pênaltis para a Argentina, mas viu Mbappé repetir um feito que não acontecia desde Geoff Hurst em 1966: marcar três gols numa final.',
    ],
    momento: {
      ano: '9 de julho de 2006 · Final vs. Itália',
      texto: 'Aos 110 minutos, com o placar empatado em 1 a 1, Marco Materazzi puxou a camisa de Zinedine Zidane e, segundo o próprio Zidane relatou depois, fez um comentário ofensivo sobre sua família. Zidane deu meia-volta e acertou uma cabeçada no peito do italiano. Expulso, saiu de campo passando ao lado da taça que não ergueria. A França perdeu a disputa de pênaltis por 5 a 3 — e a imagem da expulsão se tornou mais famosa que qualquer gol daquela Copa.',
    },
    protagonist: {
      nome: 'Zinedine Zidane',
      papel: 'símbolo do título de 1998 e da queda de 2006',
      photo: {
        src: 'https://upload.wikimedia.org/wikipedia/commons/e/e3/Zinedine_Zidane_%28cropped%29.JPG',
        alt: 'Zinedine Zidane',
        credit: 'hywell, CC BY 2.0',
      },
      bio: 'Nascido em Marselha, filho de imigrantes argelinos, Zidane é a figura que melhor resume a seleção francesa multicultural que venceu em 1998 — apelidada de "Black-Blanc-Beur" pela imprensa da época. Eleito três vezes o Melhor do Mundo pela FIFA (1998, 2000 e 2003), encerrou a carreira de jogador exatamente na final de 2006, com a expulsão mais discutida da história das Copas.',
    },
    curiosidades: [
      'Zidane é o único jogador expulso numa final de Copa depois de já ter sido campeão na mesma competição.',
      'Mbappé (2022) e Hurst (1966) são os únicos jogadores da história a marcar hat-trick numa final de Copa do Mundo — mesmo assim, a França perdeu em 2022.',
      'A França disputou 4 das últimas 7 finais de Copa do Mundo (1998, 2006, 2018, 2022) — nenhuma outra seleção chegou tão perto tantas vezes neste período.',
    ],
  },
  {
    code: 'ESP',
    name: 'Espanha',
    flag: '🇪🇸',
    chave: 'Chave 1 — enfrenta a França em 14/07',
    stats: { titulos: 1, aparicoes: 17, jogos: 63, vitorias: 30, semifinais: '2 semifinais (2010, 2026)' },
    photo: {
      src: 'https://upload.wikimedia.org/wikipedia/commons/3/32/2010_FIFA_World_Cup_Spain_with_cup.JPG',
      alt: 'Seleção espanhola celebra o título da Copa do Mundo de 2010 na África do Sul',
      credit: 'Christophe Badoux, 2010 · CC BY-SA 3.0',
    },
    intro: 'A Espanha é a seleção mais recente a ganhar sua primeira Copa do Mundo — e fez isso no meio do único tricampeonato consecutivo de torneios internacionais (Euro-Mundial-Euro) da história do futebol masculino.',
    paragraphs: [
      'Antes de 2010, o melhor resultado espanhol era um distante 4º lugar em 1950, no Brasil. A "fúria espanhola" tinha fama de decepcionar nas grandes competições apesar de sempre ter bons jogadores — até que a geração de Xavi Hernández, Andrés Iniesta e Carles Puyol — formada na cantera do Barcelona — ao lado de Iker Casillas, criado nas categorias de base do Real Madrid, mudou a história.',
      'Essa geração venceu a Eurocopa de 2008, depois a Copa do Mundo de 2010, e fechou o ciclo com outra Eurocopa em 2012 — o único tricampeonato seguido de torneios continentais e mundiais já visto no futebol masculino. O estilo ficou conhecido como tiki-taka: posse de bola extrema, passes curtos, paciência para desmontar qualquer defesa.',
      'A final de 2010, na África do Sul, contra a Holanda, foi um jogo duríssimo — 14 cartões amarelos, recorde de uma final de Copa até hoje, poucas chances claras — decidido só nos minutos finais da prorrogação. A Espanha venceu o torneio inteiro marcando apenas oito gols em sete partidas, a maioria delas por 1 a 0, um retrato perfeito de como aquele time jogava: controlava o jogo até o adversário se cansar.',
    ],
    momento: {
      ano: '11 de julho de 2010 · Final vs. Holanda',
      texto: 'Aos 116 minutos, com o jogo zerado, Cesc Fàbregas encontrou Andrés Iniesta na entrada da área. Iniesta bateu cruzado, sem chances para o goleiro holandês. Na comemoração, tirou a camisa para mostrar uma escrita no undershirt: "Dani Jarque, sempre con nosotros" — homenagem a um ex-companheiro de seleções de base, morto por parada cardíaca um ano antes. Levou cartão amarelo, mas deu à Espanha seu primeiro título mundial.',
    },
    protagonist: {
      nome: 'Xavi Hernández',
      papel: 'o maestro do tiki-taka',
      photo: {
        src: 'https://upload.wikimedia.org/wikipedia/commons/e/e5/Xavi_Catalunya.jpg',
        alt: 'Xavi Hernández em campo',
        credit: 'Laia (Reus, Catalunha), CC BY 2.0',
      },
      bio: 'Xavi foi eleito o melhor jogador da Eurocopa de 2008 e é considerado por muitos o cérebro tático da geração de ouro espanhola — o jogador que ditava o ritmo lento e hipnótico do tiki-taka. Ao lado de Iniesta, formou a dupla de meio-campo mais premiada da história da seleção, base do Barcelona que dominou a Europa no mesmo período.',
    },
    curiosidades: [
      'A geração de Xavi, Iniesta e Casillas é a única da história a vencer Eurocopa-Copa do Mundo-Eurocopa em sequência (2008, 2010, 2012).',
      'A Espanha venceu o título de 2010 marcando só 8 gols em 7 jogos — a campanha campeã com menos gols da era moderna.',
      'Iniesta guardava a homenagem ao amigo Dani Jarque escrita por baixo da camisa titular durante toda a Copa de 2010, revelada só no gol da final.',
    ],
  },
]

export default function Historia() {
  return (
    <div className="page historia-page fade-in-1">
      <div className="info-page-hero">
        <div>
          <div className="info-page-eyebrow">História</div>
          <h1 className="page-title">Rumo à decisão: a história das 4 semifinalistas</h1>
          <p className="info-page-intro">
            Argentina, Inglaterra, França e Espanha somam 7 títulos mundiais, 12 finais disputadas e mais de
            um século de campanhas entre elas. Antes das partidas de 14 e 15 de julho, a trajetória completa
            de cada seleção — títulos, momentos decisivos, protagonistas e curiosidades.
          </p>
        </div>
        <div className="row-wrap">
          <Link to="/torneio" className="btn btn-primary btn-sm">Ver chaveamento</Link>
          <Link to="/dashboard" className="btn btn-ghost btn-sm">Abrir simulador</Link>
        </div>
      </div>

      <div className="historia-teams mt-8">
        {TEAMS.map((team, i) => (
          <article key={team.code} className={`historia-team fade-in-${Math.min(i + 2, 5)}`}>

            <div className="historia-team__hero">
              <img src={team.photo.src} alt={team.photo.alt} loading="lazy" />
              <div className="historia-team__hero-overlay">
                <span className="badge">{team.chave}</span>
                <h2 className="historia-team__name">{team.flag} {team.name}</h2>
              </div>
              <span className="historia-card__credit">{team.photo.credit}</span>
            </div>

            <div className="historia-team__stats">
              <div className="historia-stat">
                <div className="historia-stat__num">{team.stats.titulos}</div>
                <div className="historia-stat__label">título{team.stats.titulos > 1 ? 's' : ''}</div>
              </div>
              <div className="historia-stat">
                <div className="historia-stat__num">{team.stats.aparicoes}</div>
                <div className="historia-stat__label">Copas disputadas</div>
              </div>
              <div className="historia-stat">
                <div className="historia-stat__num">{team.stats.jogos}</div>
                <div className="historia-stat__label">jogos</div>
              </div>
              <div className="historia-stat">
                <div className="historia-stat__num">{team.stats.vitorias}</div>
                <div className="historia-stat__label">vitórias</div>
              </div>
              <div className="historia-stat historia-stat--wide">
                <div className="historia-stat__label historia-stat__label--top">{team.stats.semifinais}</div>
              </div>
            </div>

            <div className="historia-team__body">
              <div className="historia-team__main">
                <p className="info-page-copy historia-team__lede">{team.intro}</p>

                <h3 className="historia-subhead">A trajetória</h3>
                <div className="stack gap-4">
                  {team.paragraphs.map((p, idx) => (
                    <p key={idx} className="info-page-copy">{p}</p>
                  ))}
                </div>

                <blockquote className="historia-moment">
                  <div className="historia-moment__tag">{team.momento.ano}</div>
                  {team.momento.photo && (
                    <div className="historia-moment__photo">
                      <img src={team.momento.photo.src} alt={team.momento.photo.alt} loading="lazy" />
                      <span className="historia-card__credit">{team.momento.photo.credit}</span>
                    </div>
                  )}
                  <p>{team.momento.texto}</p>
                </blockquote>
              </div>

              <aside className="historia-team__aside">
                <div className="card historia-protagonist">
                  <div className="historia-protagonist__photo">
                    <img src={team.protagonist.photo.src} alt={team.protagonist.photo.alt} loading="lazy" />
                    <span className="historia-card__credit">{team.protagonist.photo.credit}</span>
                  </div>
                  <div className="card__body">
                    <div className="info-page-eyebrow">Protagonista</div>
                    <div className="historia-protagonist__name">{team.protagonist.nome}</div>
                    <div className="historia-protagonist__role">{team.protagonist.papel}</div>
                    <p className="info-page-copy mt-3">{team.protagonist.bio}</p>
                  </div>
                </div>

                <div className="card historia-curiosities">
                  <div className="card__header">
                    <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                      Curiosidades
                    </span>
                  </div>
                  <div className="card__body">
                    <ul className="historia-curiosities__list">
                      {team.curiosidades.map((c, idx) => <li key={idx}>{c}</li>)}
                    </ul>
                  </div>
                </div>
              </aside>
            </div>
          </article>
        ))}
      </div>

      <p className="historia-page__footnote">
        Fotos históricas via Wikimedia Commons, sob licença de domínio público ou Creative Commons — crédito completo em cada imagem.
      </p>
    </div>
  )
}
