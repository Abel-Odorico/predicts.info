# Guia Admin

## Areas do painel

### `/admin`

Painel operacional principal.

Contem:

- Insercao manual de resultados
- Sincronizacao de dados reais
- Limpeza de cache
- Promocao de usuario para admin
- Apostas recentes
- Cobertura por jogo

### Cobertura por jogo

Secao nova no admin para verificar cobertura de apostas por partida.

Mostra:

- partida
- grupo
- data
- quantos usuarios ja apostaram
- quantos usuarios ainda nao apostaram
- lista nominal de quem apostou com placar
- lista nominal de quem ainda nao apostou

Filtros:

- `Abertos`
- `Finalizados`
- `Todos`

## `/admin/options`

Painel de configuracoes do site.

### Identidade e credito

Campos importantes:

- `Titulo do site`
- `Subtitulo`
- `Desenvolvido por`

O texto `Desenvolvido por` aparece publicamente no app e na landing.

### Paginas publicas editaveis

Paginas:

- `/privacidade`
- `/termos`
- `/sobre`
- `/contato`

Cada pagina possui:

- titulo
- introducao
- conteudo

Formato do conteudo:

- usar `## Titulo da secao` para criar secoes
- separar paragrafos com linha em branco

Campos adicionais:

- `Email geral`
- `Email de privacidade`

### AdSense

Campos relevantes:

- `AdSense ativo`
- `Publisher ID`
- `Auto Ads`
- slots opcionais

Observacoes:

- o publisher precisa estar no formato `ca-pub-...`
- o `ads.txt` publicado usa `pub-...`
- a verificacao depende de snippet, meta e `ads.txt`

## `/admin/analytics`

Painel de analytics.

Filtros de periodo:

- `Hoje`
- `7 dias`
- `14 dias`
- `30 dias`
- `90 dias`
- `1 ano`

Afeta:

- KPIs
- views por dia
- paginas
- geografico
- tecnologia
- visitas recentes

## Operacao de apostas

### Tela publica `/apostas`

Comportamento atual:

- jogos abertos mostram formulario inline de aposta
- usuario pode atualizar aposta enquanto a partida nao iniciou
- card da aposta possui botao `Ver Simulacao`

### Regras

- `3 pts`: placar exato
- `1 pt`: resultado correto
- `0 pt`: sem acerto

## Grupos privados dos usuarios

### Rota do frontend

- `/meus-grupos`

### Fluxo

1. usuario autenticado cria um grupo
2. criador vira dono do grupo
3. dono pode convidar:
   - por busca de usuario
   - por email
4. usuario convidado recebe convite pendente
5. convite precisa ser aceito ou recusado

### Estado atual

Disponivel:

- criar grupo
- listar membros
- listar convites pendentes
- buscar usuarios
- convidar por email
- aceitar convite
- recusar convite

Ainda nao implementado:

- remover membro
- cancelar convite
- ranking isolado por grupo privado
- link magico de convite

## Endpoints novos

### Admin

- `GET /api/admin/bets/coverage`

### Grupos privados

- `GET /api/user-groups`
- `POST /api/user-groups`
- `GET /api/user-groups/users/search?q=...`
- `POST /api/user-groups/{group_id}/invites`
- `POST /api/user-groups/invites/{invite_id}/accept`
- `POST /api/user-groups/invites/{invite_id}/reject`

## Deploy de mudancas

### Mudancas de frontend

```bash
cd /opt/predicts/frontend
npm run build
```

### Sincronizar landing

```bash
cp /opt/predicts/frontend/public/index-landing.html /opt/predicts/frontend/dist/landing.html
cp /opt/predicts/frontend/public/index-landing.html /opt/predicts/frontend/dist/index-landing.html
```

### Mudancas de backend

```bash
cd /opt/predicts
docker compose restart api
```

## Validacao rapida

Sem autenticar:

- rotas protegidas devem responder `401`

Com admin autenticado:

- abrir `/admin`
- abrir `/admin/options`
- abrir `/admin/analytics`
- validar nova secao de cobertura de apostas

Com usuario autenticado:

- abrir `/meus-grupos`
- criar grupo
- enviar convite
- aceitar convite com o usuario convidado
