"""
GET  /api/site-config/public   — public site config (no auth)
GET  /api/site-config/all      — all config keys (admin)
PUT  /api/site-config/{key}    — update a config key (admin)
POST /api/site-config/bulk     — update multiple keys at once (admin)
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from auth_utils import require_admin
from models import SiteConfig, User

router = APIRouter(prefix="/site-config", tags=["site-config"])

DEFAULTS: dict[str, str] = {
    "site_title":        "Predicts.info",
    "site_subtitle":     "World Cup 2026 Simulator",
    "hero_headline":     "Predict the Future of the World Cup",
    "hero_subheadline":  "Powered by Poisson + Elo + Monte Carlo (1M simulations)",
    "hero_cta":          "Start Simulating",
    "banner_text":       "",
    "banner_enabled":    "false",
    "user_notice_enabled":      "true",
    "user_notice_title":        "Complete seu perfil",
    "user_notice_text":         "Agora você pode {itens} para deixar sua conta mais fácil de encontrar nos bolões.",
    "user_notice_button":       "Atualizar perfil",
    "user_notice_url":          "/perfil",
    "user_notice_profile_only": "true",
    "meta_title":        "Predicts.info — World Cup 2026 Statistical Simulator",
    "meta_description":  "AI-powered World Cup 2026 predictions. Poisson + Elo + Monte Carlo simulations. Live scores, group standings, bracket projections and betting.",
    "meta_keywords":     "world cup 2026 predictions, FIFA 2026 simulator, football predictions, copa 2026",
    "footer_text":       "Statistical predictions powered by Monte Carlo simulation.",
    "developer_credit":  "PeepConnect - By Abel Odorico",
    # Institutional pages
    "privacy_title":     "Politica de Privacidade",
    "privacy_intro":     "Esta pagina explica quais dados o Predicts.info pode coletar, por que eles sao usados e como publicidade e analytics se relacionam com o funcionamento do site.",
    "privacy_content":   "## 1. Dados coletados\nO Predicts.info coleta dados tecnicos basicos para operar o site, como paginas visitadas, dispositivo, navegador, idioma, endereco IP aproximado e horario de acesso.\n\nQuando voce cria conta ou faz login, o site tambem pode armazenar nome, email, identificadores internos e historico de palpites vinculados ao seu usuario.\n\n## 2. Como usamos esses dados\nOs dados sao usados para entregar o simulador, autenticar usuarios, manter ranking, detectar abuso, gerar metricas agregadas de uso e melhorar a experiencia do produto.\n\nTambem podemos usar tecnologias de publicidade, incluindo Google AdSense, para exibir anuncios e medir desempenho de anuncios quando esse recurso estiver ativo.\n\n## 3. Cookies, armazenamento local e anuncios\nO site pode usar cookies e armazenamento local do navegador para manter sessao, preferencias de idioma, seguranca e medicao de uso.\n\nFornecedores terceiros, incluindo o Google, podem usar cookies para veicular anuncios com base em visitas anteriores do usuario a este e a outros sites.\n\nUsuarios podem gerenciar preferencias de anuncios nas configuracoes do Google e nas configuracoes do proprio navegador.\n\n## 4. Compartilhamento e seguranca\nNao vendemos dados pessoais. Dados podem ser compartilhados apenas com provedores tecnicos necessarios para hospedagem, seguranca, analise, autenticacao e publicidade.\n\nEmpregamos medidas tecnicas razoaveis para proteger as informacoes, mas nenhum sistema conectado a internet garante seguranca absoluta.\n\n## 5. Seus direitos\nVoce pode solicitar correcao, exclusao ou esclarecimentos sobre seus dados entrando em contato pelos canais desta pagina.\n\nAo continuar usando o Predicts.info, voce concorda com esta politica de privacidade.",
    "terms_title":       "Termos de Uso",
    "terms_intro":       "Estes termos definem as condicoes de acesso e uso do Predicts.info, incluindo limites de responsabilidade e regras basicas de conduta.",
    "terms_content":     "## 1. Uso do servico\nO Predicts.info oferece simulacoes estatisticas, rankings, palpites e informacoes relacionadas a futebol internacional, especialmente a Copa do Mundo de 2026.\n\nO uso do site deve ser feito de forma licita, sem tentativa de fraude, automacao abusiva, raspagem agressiva ou qualquer acao que prejudique o funcionamento da plataforma.\n\n## 2. Natureza informativa\nAs probabilidades, simulacoes e projecoes apresentadas no site sao estimativas estatisticas e informativas. Elas nao constituem promessa de resultado real.\n\nO Predicts.info nao e afiliado a FIFA e nao garante exatidao total, disponibilidade ininterrupta ou atualizacao perfeita de fontes externas.\n\n## 3. Contas e conteudo do usuario\nUsuarios sao responsaveis por manter a confidencialidade de suas credenciais e pela atividade realizada em suas contas.\n\nPodemos suspender ou remover contas e acessos em caso de abuso, tentativa de invasao, spam, manipular rankings ou violacao destes termos.\n\n## 4. Propriedade intelectual\nO design do produto, textos originais, organizacao das informacoes, sinais visuais e software do site pertencem ao projeto ou a seus respectivos titulares.\n\nMarcas, nomes de selecoes, competicoes, emissoras e entidades esportivas pertencem a seus donos legitimos.\n\n## 5. Alteracoes\nEstes termos podem ser atualizados a qualquer momento para refletir mudancas tecnicas, legais ou operacionais.\n\nO uso continuado do site apos alteracoes publicadas representa aceitacao da versao mais recente.",
    "about_title":       "Sobre o Predicts.info",
    "about_intro":       "Conheca rapidamente o objetivo do projeto, a natureza do conteudo e a base estatistica usada para gerar previsoes e simulacoes.",
    "about_content":     "## O que e o Predicts.info\nO Predicts.info e um projeto focado em previsoes estatisticas de futebol com interface publica, rankings e simulacoes da Copa do Mundo de 2026.\n\nO produto combina ratings Elo, distribuicao de Poisson, ajustes por contexto e simulacoes Monte Carlo para projetar partidas e avancos no torneio.\n\n## Como o site funciona\nCada partida pode ser simulada individualmente e o torneio inteiro pode ser recalculado para estimar chances de classificacao, mata-mata e titulo.\n\nO site tambem agrega calendario, resultados e placares ao vivo de fontes externas quando disponiveis, sempre com finalidade informativa.\n\n## Objetivo editorial\nNosso objetivo e entregar um painel util para torcedores, curiosos e pessoas interessadas em modelagem esportiva, sem paywall e com navegacao simples.\n\nO conteudo publicado tem foco em analise, simulacao e acompanhamento esportivo, nao em jogos de azar por dinheiro real.",
    "contact_title":     "Contato",
    "contact_intro":     "Esta pagina centraliza os canais para suporte, questoes de privacidade, denuncias de abuso e comunicacoes relacionadas ao Predicts.info.",
    "contact_content":   "## Fale com o projeto\nPara assuntos de suporte, privacidade, remocao de dados, erros de conteudo ou temas comerciais, use os canais listados nesta pagina.\n\nAo entrar em contato, inclua o maximo de contexto possivel para facilitar a analise do pedido, como pagina acessada, horario aproximado e descricao do problema.\n\n## Tempo de resposta\nMensagens relacionadas a privacidade, seguranca, abuso ou problemas tecnicos criticos recebem prioridade.\n\nO prazo de resposta pode variar conforme volume de solicitacoes e disponibilidade operacional do projeto.",
    "contact_email":     "contact@predicts.info",
    "privacy_email":     "privacy@predicts.info",
    # AdSense
    "adsense_enabled":       "false",
    "adsense_publisher_id":  "",
    "adsense_auto_ads":      "true",
    "adsense_slot_header":   "",
    "adsense_slot_content":  "",
    "adsense_slot_footer":   "",
    # Telegram
    "telegram_bot_token":    "",
    "telegram_chat_id":      "",
    # WhatsApp (Evolution API)
    "whatsapp_enabled":      "false",
    "whatsapp_api_url":      "",
    "whatsapp_api_key":      "",
    "whatsapp_instance":     "predicts",
    "whatsapp_webhook_secret": "",
    # Modo silêncio: bloqueia mensagem PROATIVA (campanha, lembrete, grupo, resultado,
    # destaque, novidades) na janela configurada. Resposta a mensagem recebida sempre passa.
    "whatsapp_quiet_enabled": "true",
    "whatsapp_quiet_start":   "22",  # hora BRT (0-23), início da janela
    "whatsapp_quiet_end":     "8",   # hora BRT (0-23), fim da janela
    # WhatsApp Oficial (Meta Cloud API) — em paralelo ao Evolution/Baileys, não substitui
    "whatsapp_meta_enabled":      "false",
    "whatsapp_meta_token":        "",
    "whatsapp_meta_phone_id":     "",
    "whatsapp_meta_waba_id":      "",
    "whatsapp_meta_verify_token": "",
    # Video upload
    "video_upload_token":    "peep2026",
}

PUBLIC_KEYS = {
    "site_title", "site_subtitle", "hero_headline", "hero_subheadline",
    "hero_cta", "banner_text", "banner_enabled",
    "user_notice_enabled", "user_notice_title", "user_notice_text",
    "user_notice_button", "user_notice_url", "user_notice_profile_only",
    "meta_title", "meta_description", "meta_keywords", "footer_text", "developer_credit",
    "privacy_title", "privacy_intro", "privacy_content",
    "terms_title", "terms_intro", "terms_content",
    "about_title", "about_intro", "about_content",
    "contact_title", "contact_intro", "contact_content",
    "contact_email", "privacy_email",
    # AdSense keys are public so landing page can inject script client-side
    "adsense_enabled", "adsense_publisher_id", "adsense_auto_ads",
    "adsense_slot_header", "adsense_slot_content", "adsense_slot_footer",
}


def _get_all(db: Session) -> dict[str, str]:
    rows = db.query(SiteConfig).all()
    result = dict(DEFAULTS)
    for row in rows:
        result[row.key] = row.value
    return result


@router.get("/public")
def public_config(db: Session = Depends(get_db)):
    all_cfg = _get_all(db)
    return {k: v for k, v in all_cfg.items() if k in PUBLIC_KEYS}


@router.get("/all")
def all_config(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return _get_all(db)


class ConfigValue(BaseModel):
    value: str


class BulkConfig(BaseModel):
    updates: dict[str, str]


@router.put("/{key}")
def update_config(
    key: str,
    payload: ConfigValue,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if key not in DEFAULTS:
        raise HTTPException(400, f"Unknown config key: {key}")
    row = db.query(SiteConfig).filter(SiteConfig.key == key).first()
    if row:
        row.value = payload.value
        row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    else:
        db.add(SiteConfig(key=key, value=payload.value))
    db.commit()
    return {"key": key, "value": payload.value}


@router.post("/bulk")
def bulk_update(
    payload: BulkConfig,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    for key, value in payload.updates.items():
        if key not in DEFAULTS:
            continue
        row = db.query(SiteConfig).filter(SiteConfig.key == key).first()
        if row:
            row.value = value
            row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        else:
            db.add(SiteConfig(key=key, value=value))
    db.commit()
    return {"updated": list(payload.updates.keys())}
