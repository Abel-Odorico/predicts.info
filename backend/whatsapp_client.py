"""
Cliente HTTP para a Evolution API (WhatsApp).
Config lida de site_config (admin) com fallback pra config.py/.env, mesmo padrão do report.py (Telegram).
"""
import re
from urllib.parse import urlparse, parse_qs
import httpx
from sqlalchemy.orm import Session
from config import settings
from models import SiteConfig


def _cfg(db: Session) -> dict:
    rows = {
        r.key: r.value
        for r in db.query(SiteConfig).filter(
            SiteConfig.key.in_([
                "whatsapp_enabled", "whatsapp_api_url", "whatsapp_api_key",
                "whatsapp_instance", "whatsapp_webhook_secret",
            ])
        )
    }
    return {
        "enabled": (rows.get("whatsapp_enabled") or "false").lower() == "true",
        "url": (rows.get("whatsapp_api_url") or settings.whatsapp_api_url).rstrip("/"),
        "api_key": rows.get("whatsapp_api_key") or settings.whatsapp_api_key,
        "instance": rows.get("whatsapp_instance") or settings.whatsapp_instance,
        "webhook_secret": rows.get("whatsapp_webhook_secret") or settings.whatsapp_webhook_secret,
    }


def is_quiet_now(db: Session) -> bool:
    """Modo silêncio (horário BRT): True = mensagem PROATIVA bloqueada agora.

    Regra do produto: nunca mandar WhatsApp de madrugada, EXCETO resposta a mensagem
    que o usuário acabou de mandar (chamador passa ignore_quiet=True). Config no admin
    (site_config): whatsapp_quiet_enabled / whatsapp_quiet_start / whatsapp_quiet_end.
    Janela cruza meia-noite normalmente (ex.: 22 → 8)."""
    from datetime import datetime, timezone, timedelta

    rows = {
        r.key: r.value
        for r in db.query(SiteConfig).filter(SiteConfig.key.in_([
            "whatsapp_quiet_enabled", "whatsapp_quiet_start", "whatsapp_quiet_end",
        ]))
    }
    if (rows.get("whatsapp_quiet_enabled") or "true").lower() != "true":
        return False
    try:
        start = int(rows.get("whatsapp_quiet_start") or 22) % 24
        end = int(rows.get("whatsapp_quiet_end") or 8) % 24
    except (TypeError, ValueError):
        start, end = 22, 8
    if start == end:
        return False  # janela vazia = silêncio desligado na prática
    hour_brt = (datetime.now(timezone.utc) - timedelta(hours=3)).hour
    if start < end:
        return start <= hour_brt < end
    return hour_brt >= start or hour_brt < end  # cruza meia-noite


def normalize_jid(phone: str) -> str:
    """Reduz telefone a dígitos puros com DDI (formato que a Evolution API espera em 'number').

    Cadastro não força DDI (_PHONE_RE em auth.py só valida tamanho) — usuário BR digita
    "31998982288" sem pensar no 55. Evolution/Baileys rejeita esse jid como inexistente
    (mensagem falha silenciosa: send_text só retorna True/False). Sem heurística aqui,
    boas-vindas/campanha/confirmação de aposta nunca chegam pra quem esqueceu o DDI.
    """
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        return digits
    if len(digits) in (10, 11) and not digits.startswith("55"):
        digits = "55" + digits
    return digits


def resolve_number(db: Session, phone: str) -> str | None:
    """Resolve o JID real via Evolution API antes de mandar.

    BR tem o quirk do 9º dígito: cadastro salva "31998982288" (com 9), mas o JID real
    do WhatsApp pra contas mais antigas é "553198982288" (sem 9) — mandar pro número
    "errado" retorna 2xx (fica "sent" no banco) mas nunca entrega, silenciosamente.
    `/chat/whatsappNumbers` resolve pro JID que realmente existe.
    """
    cfg = _cfg(db)
    digits = normalize_jid(phone)
    if not digits:
        return None
    try:
        resp = httpx.post(
            f"{cfg['url']}/chat/whatsappNumbers/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            json={"numbers": [digits]},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if data and data[0].get("exists"):
            jid = data[0].get("jid") or ""
            resolved = jid.split("@")[0]
            if resolved:
                return resolved
    except (httpx.HTTPError, ValueError, IndexError, KeyError):
        pass
    return digits  # fallback: melhor tentar o número naive do que não mandar nada


def send_text(db: Session, phone: str, message: str, ignore_quiet: bool = False) -> bool:
    """Manda texto simples. Retorna True/False, nunca levanta — chamador decide o que fazer com falha.

    ignore_quiet=True só pra mensagem que RESPONDE ação do usuário (webhook, boas-vindas,
    confirmação de aposta, envio manual do admin) — o resto respeita o modo silêncio."""
    cfg = _cfg(db)
    if not cfg["enabled"] or not cfg["api_key"]:
        return False
    if not ignore_quiet and is_quiet_now(db):
        return False
    number = resolve_number(db, phone)
    if not number:
        return False
    try:
        resp = httpx.post(
            f"{cfg['url']}/message/sendText/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            json={"number": number, "text": message},
            timeout=15,
        )
        return resp.status_code < 300
    except httpx.HTTPError:
        return False


def send_list(db: Session, phone: str, title: str, description: str, button_text: str, sections: list[dict], ignore_quiet: bool = False) -> bool:
    """Menu nativo WhatsApp (lista clicável). Baileys manda o payload certinho, mas WhatsApp
    restringe mensagem interativa a critério do cliente do usuário — nem todo app renderiza
    (mais comum em número pessoal, não Business API oficial). 2xx aqui NÃO garante que apareceu
    na tela; sem confirmação de entrega por tipo de mensagem, o único jeito de saber é o
    destinatário confirmar. Chamador deve ter fallback em texto pronto pra quando isso falhar
    (falha de rede) OU não fazer nada (silêncio do lado do WhatsApp, não dá pra distinguir daqui).
    """
    cfg = _cfg(db)
    if not cfg["enabled"] or not cfg["api_key"]:
        return False
    if not ignore_quiet and is_quiet_now(db):
        return False
    number = resolve_number(db, phone)
    if not number:
        return False
    try:
        resp = httpx.post(
            f"{cfg['url']}/message/sendList/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            json={
                "number": number,
                "title": title,
                "description": description,
                "buttonText": button_text,
                "footerText": "predicts.info",
                "sections": sections,
            },
            timeout=15,
        )
        return resp.status_code < 300
    except httpx.HTTPError:
        return False


def send_text_to_jid(db: Session, jid: str, message: str, ignore_quiet: bool = False) -> bool:
    """Manda texto direto pro JID (sem resolve_number) — usado na thread do admin, onde o jid
    já vem de /chat/findChats (inclui @lid, que não tem telefone real pra normalizar)."""
    cfg = _cfg(db)
    if not cfg["enabled"] or not cfg["api_key"]:
        return False
    if not ignore_quiet and is_quiet_now(db):
        return False
    try:
        resp = httpx.post(
            f"{cfg['url']}/message/sendText/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            json={"number": jid, "text": message},
            timeout=15,
        )
        return resp.status_code < 300
    except httpx.HTTPError:
        return False


def find_messages(db: Session, remote_jid: str, limit: int = 50) -> list | None:
    """Histórico real da conversa direto do WhatsApp (Baileys), não do nosso log —
    cobre também chats @lid, que não têm telefone pra casar com o WhatsappMessage local."""
    cfg = _cfg(db)
    if not cfg["enabled"] or not cfg["api_key"]:
        return None
    try:
        resp = httpx.post(
            f"{cfg['url']}/chat/findMessages/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            json={"where": {"key": {"remoteJid": remote_jid}}, "limit": limit},
            timeout=15,
        )
        resp.raise_for_status()
        return (resp.json().get("messages") or {}).get("records") or []
    except (httpx.HTTPError, ValueError):
        return None


def create_group(db: Session, subject: str, participants: list[str]) -> dict | None:
    cfg = _cfg(db)
    if not cfg["enabled"] or not cfg["api_key"]:
        return None
    numbers = [normalize_jid(p) for p in participants if normalize_jid(p)]
    try:
        resp = httpx.post(
            f"{cfg['url']}/group/create/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            json={"subject": subject, "participants": numbers},
            timeout=20,
        )
        if resp.status_code < 300:
            return resp.json()
        return None
    except httpx.HTTPError:
        return None


def list_groups(db: Session) -> list | None:
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return None
    try:
        resp = httpx.get(
            f"{cfg['url']}/group/fetchAllGroups/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            params={"getParticipants": "false"},
            timeout=20,
        )
        if resp.status_code < 300:
            data = resp.json()
            return data if isinstance(data, list) else data.get("groups", [])
        return None
    except httpx.HTTPError:
        return None


def group_participants(db: Session, group_jid: str) -> list | None:
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return None
    try:
        resp = httpx.get(
            f"{cfg['url']}/group/participants/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            params={"groupJid": group_jid},
            timeout=15,
        )
        if resp.status_code < 300:
            return resp.json().get("participants", [])
        return None
    except httpx.HTTPError:
        return None


def update_group_subject(db: Session, group_jid: str, subject: str) -> bool:
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return False
    try:
        resp = httpx.post(
            f"{cfg['url']}/group/updateGroupSubject/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]}, params={"groupJid": group_jid},
            json={"subject": subject}, timeout=15,
        )
        return resp.status_code < 300
    except httpx.HTTPError:
        return False


def update_group_description(db: Session, group_jid: str, description: str) -> bool:
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return False
    try:
        resp = httpx.post(
            f"{cfg['url']}/group/updateGroupDescription/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]}, params={"groupJid": group_jid},
            json={"description": description}, timeout=15,
        )
        return resp.status_code < 300
    except httpx.HTTPError:
        return False


def update_group_participants(db: Session, group_jid: str, action: str, participants: list[str]) -> bool:
    """action: add | remove | promote | demote"""
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return False
    numbers = [normalize_jid(p) for p in participants if normalize_jid(p)]
    if not numbers:
        return False
    try:
        resp = httpx.post(
            f"{cfg['url']}/group/updateParticipant/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]}, params={"groupJid": group_jid},
            json={"action": action, "participants": numbers}, timeout=15,
        )
        return resp.status_code < 300
    except httpx.HTTPError:
        return False


def leave_group(db: Session, group_jid: str) -> bool:
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return False
    try:
        resp = httpx.delete(
            f"{cfg['url']}/group/leaveGroup/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]}, params={"groupJid": group_jid},
            timeout=15,
        )
        return resp.status_code < 300
    except httpx.HTTPError:
        return False


def webhook_status(db: Session) -> dict | None:
    """Diagnóstico do webhook: se cair (desativado/URL/evento errado), aposta-por-WhatsApp para de responder silenciosamente."""
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return None
    try:
        resp = httpx.get(
            f"{cfg['url']}/webhook/find/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            timeout=10,
        )
        if resp.status_code >= 300:
            return None
        data = resp.json() or {}
        url = data.get("url") or ""
        parsed = urlparse(url)
        secret_ok = parse_qs(parsed.query).get("secret", [None])[0] == cfg["webhook_secret"]
        path_ok = parsed.path.endswith("/api/webhook/whatsapp") or parsed.path.endswith("/webhook/whatsapp")
        events = data.get("events") or []
        enabled = bool(data.get("enabled"))
        return {
            "enabled": enabled,
            "url": url,
            "events": events,
            "healthy": enabled and path_ok and secret_ok and "MESSAGES_UPSERT" in events,
        }
    except httpx.HTTPError:
        return None


def find_chats(db: Session) -> list | None:
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return None
    try:
        resp = httpx.post(
            f"{cfg['url']}/chat/findChats/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            json={},
            timeout=15,
        )
        return resp.json() if resp.status_code < 300 else None
    except httpx.HTTPError:
        return None


def instance_qrcode(db: Session) -> dict | None:
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return None
    try:
        resp = httpx.get(
            f"{cfg['url']}/instance/connect/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            timeout=15,
        )
        return resp.json() if resp.status_code < 300 else None
    except httpx.HTTPError:
        return None


def instance_status(db: Session) -> dict | None:
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return None
    try:
        resp = httpx.get(
            f"{cfg['url']}/instance/connectionState/{cfg['instance']}",
            headers={"apikey": cfg["api_key"]},
            timeout=10,
        )
        return resp.json() if resp.status_code < 300 else None
    except httpx.HTTPError:
        return None


def instance_info(db: Session) -> dict | None:
    """Detalhes ricos da instância (perfil, número, datas, contadores) via fetchInstances."""
    cfg = _cfg(db)
    if not cfg["api_key"]:
        return None
    try:
        resp = httpx.get(
            f"{cfg['url']}/instance/fetchInstances",
            params={"instanceName": cfg["instance"]},
            headers={"apikey": cfg["api_key"]},
            timeout=10,
        )
        if resp.status_code >= 300:
            return None
        data = resp.json()
        items = data if isinstance(data, list) else data.get("data") or []
        found = next((i for i in items if i.get("name") == cfg["instance"]), items[0] if items else None)
        if not found:
            return None
        owner = found.get("ownerJid") or ""
        counts = found.get("_count") or {}
        return {
            "instance_name": found.get("name") or cfg["instance"],
            "profile_name": found.get("profileName"),
            "profile_pic_url": found.get("profilePicUrl"),
            "number": owner.split("@")[0] if owner else None,
            "connection_status": found.get("connectionStatus"),
            "integration": found.get("integration"),
            "created_at": found.get("createdAt"),
            "updated_at": found.get("updatedAt"),
            "message_count": counts.get("Message", 0),
            "contact_count": counts.get("Contact", 0),
            "chat_count": counts.get("Chat", 0),
        }
    except httpx.HTTPError:
        return None
