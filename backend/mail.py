"""
SMTP helper — envio de e-mail transacional.
Usa smtplib stdlib; sem dependências externas.
"""
import smtplib
import ssl
import uuid
from email import utils as email_utils
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

from config import settings


def _cfg() -> dict:
    return {
        "enabled":      settings.mail_enabled,
        "host":         settings.mail_host,
        "port":         settings.mail_port,
        "username":     settings.mail_username,
        "password":     settings.mail_password,
        "encryption":   settings.mail_encryption.lower(),
        "timeout":      settings.mail_timeout,
        "from_address": settings.mail_from_address,
        "from_name":    settings.mail_from_name,
    }


def send_email(to: str, subject: str, html: str, plain: str = "") -> bool:
    cfg = _cfg()
    if not cfg["enabled"] or not cfg["from_address"]:
        print(f"[mail] desabilitado — não enviou para {to}", flush=True)
        return False

    domain = cfg["from_address"].split("@")[-1]
    msg = MIMEMultipart("alternative")
    msg["Subject"]    = subject
    msg["From"]       = f'{cfg["from_name"]} <{cfg["from_address"]}>'
    msg["To"]         = to
    msg["Date"]       = email_utils.formatdate(localtime=True)
    msg["Message-ID"] = f"<{uuid.uuid4().hex}@{domain}>"
    msg["Reply-To"]   = cfg["from_address"]
    msg["X-Mailer"]   = "Predicts/1.0"

    # Texto simples obrigatório para evitar filtro spam
    if not plain:
        plain = f"{subject}\n\nAcesse o link enviado no HTML deste e-mail.\n\n— {cfg['from_name']}"
    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html,  "html",  "utf-8"))

    try:
        ctx = ssl.create_default_context()
        if cfg["port"] == 465 or cfg["encryption"] == "ssl":
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=ctx, timeout=cfg["timeout"]) as srv:
                srv.login(cfg["username"], cfg["password"])
                srv.sendmail(cfg["from_address"], to, msg.as_string())
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=cfg["timeout"]) as srv:
                srv.ehlo()
                srv.starttls(context=ctx)
                srv.ehlo()
                srv.login(cfg["username"], cfg["password"])
                srv.sendmail(cfg["from_address"], to, msg.as_string())
        print(f"[mail] enviado para {to} — {subject}", flush=True)
        return True
    except Exception as exc:
        print(f"[mail] ERRO ao enviar para {to}: {exc}", flush=True)
        return False


# ── Templates ──────────────────────────────────────────────────────────────

def _base_template(title: str, body_html: str) -> str:
    year = datetime.now().year
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{title}</title>
<style>
  body {{ margin:0; padding:0; background:#0d1b2a; font-family: Arial, Helvetica, sans-serif; }}
  .wrap {{ max-width:560px; margin:40px auto; background:#0d1b2a; }}
  .header {{ background:linear-gradient(135deg,#0a1628 0%,#0f2a42 100%); padding:40px 40px 32px; text-align:center; border-bottom:3px solid #0f7a78; }}
  .logo {{ font-size:42px; font-weight:900; letter-spacing:6px; color:#ffffff; line-height:1; }}
  .logo-dot {{ color:#0f7a78; }}
  .tagline {{ margin-top:6px; font-size:11px; letter-spacing:3px; text-transform:uppercase; color:#5f7790; }}
  .body {{ background:#111e2e; padding:40px; }}
  .title {{ font-size:22px; font-weight:700; color:#ffffff; margin:0 0 16px; }}
  .text {{ font-size:15px; color:#8ba0b5; line-height:1.7; margin:0 0 24px; }}
  .text strong {{ color:#e2ebf5; }}
  .btn-wrap {{ text-align:center; margin:32px 0; }}
  .btn {{ display:inline-block; background:#0f7a78; color:#ffffff !important; text-decoration:none;
          font-size:15px; font-weight:700; letter-spacing:1px; padding:16px 40px;
          border-radius:6px; text-transform:uppercase; }}
  .btn:hover {{ background:#0a5856; }}
  .divider {{ border:none; border-top:1px solid rgba(41,75,107,0.3); margin:28px 0; }}
  .link-fallback {{ font-size:12px; color:#5f7790; word-break:break-all; text-align:center; }}
  .link-fallback a {{ color:#0f7a78; }}
  .expire {{ background:rgba(15,122,120,0.08); border:1px solid rgba(15,122,120,0.2);
             border-radius:6px; padding:12px 16px; text-align:center;
             font-size:13px; color:#5f7790; margin-bottom:24px; }}
  .expire strong {{ color:#0f7a78; }}
  .footer {{ background:#0a1628; padding:24px 40px; text-align:center; border-top:1px solid rgba(41,75,107,0.3); }}
  .footer-text {{ font-size:11px; color:#34506b; line-height:1.8; }}
  .footer-text a {{ color:#0f7a78; text-decoration:none; }}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">PREDICTS<span class="logo-dot">.</span></div>
    <div class="tagline">Copa do Mundo 2026 · Simulador</div>
  </div>
  <div class="body">
    {body_html}
  </div>
  <div class="footer">
    <div class="footer-text">
      © {year} Predicts · PeepConnect<br />
      Este e-mail foi enviado automaticamente — não responda.<br />
      <a href="https://predicts.info">predicts.info</a>
    </div>
  </div>
</div>
</body>
</html>"""


def reset_password_html(name: str, reset_url: str, expire_minutes: int = 60) -> tuple[str, str]:
    """Retorna (html, plain_text)."""
    body = f"""
    <div class="title">Redefinir sua senha</div>
    <p class="text">Olá, <strong>{name}</strong>!</p>
    <p class="text">
      Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Predicts</strong>.
      Clique no botão abaixo para criar uma nova senha.
    </p>
    <div class="expire">
      ⏱ Este link expira em <strong>{expire_minutes} minutos</strong>
    </div>
    <div class="btn-wrap">
      <a href="{reset_url}" class="btn">Redefinir Senha</a>
    </div>
    <hr class="divider" />
    <p class="text" style="font-size:13px;">
      Se o botão não funcionar, copie e cole o link abaixo no seu navegador:
    </p>
    <div class="link-fallback"><a href="{reset_url}">{reset_url}</a></div>
    <hr class="divider" />
    <p class="text" style="font-size:12px; color:#5f7790;">
      Se você não solicitou a redefinição de senha, ignore este e-mail.
      Sua senha permanece a mesma e nenhuma ação é necessária.
    </p>
"""
    html = _base_template("Redefinir Senha — Predicts", body)
    plain = (
        f"Olá, {name}!\n\n"
        f"Recebemos uma solicitação para redefinir sua senha no Predicts.\n\n"
        f"Acesse o link abaixo para criar uma nova senha (válido por {expire_minutes} minutos):\n\n"
        f"{reset_url}\n\n"
        f"Se você não solicitou a redefinição, ignore este e-mail.\n\n"
        f"— Predicts · predicts.info"
    )
    return html, plain


def change_email_html(name: str, action_url: str, expire_minutes: int = 60) -> tuple[str, str]:
    """Retorna (html, plain_text)."""
    body = f"""
    <div class="title">Atualizar seu e-mail</div>
    <p class="text">Olá, <strong>{name}</strong>!</p>
    <p class="text">
      Um administrador do <strong>Predicts</strong> solicitou a atualização do e-mail da sua conta.
      Clique no botão abaixo para informar o novo e-mail.
    </p>
    <div class="expire">
      ⏱ Este link expira em <strong>{expire_minutes} minutos</strong>
    </div>
    <div class="btn-wrap">
      <a href="{action_url}" class="btn">Atualizar E-mail</a>
    </div>
    <hr class="divider" />
    <p class="text" style="font-size:13px;">
      Se o botão não funcionar, copie e cole o link abaixo no seu navegador:
    </p>
    <div class="link-fallback"><a href="{action_url}">{action_url}</a></div>
    <hr class="divider" />
    <p class="text" style="font-size:12px; color:#5f7790;">
      Se você não esperava este e-mail, ignore-o. Nenhuma alteração é feita sem confirmação.
    </p>
"""
    html = _base_template("Atualizar E-mail — Predicts", body)
    plain = (
        f"Olá, {name}!\n\n"
        f"Um administrador do Predicts solicitou a atualização do e-mail da sua conta.\n\n"
        f"Acesse o link abaixo para informar o novo e-mail (válido por {expire_minutes} minutos):\n\n"
        f"{action_url}\n\n"
        f"Se você não esperava este e-mail, ignore-o.\n\n"
        f"— Predicts · predicts.info"
    )
    return html, plain


def change_phone_html(name: str, action_url: str, expire_minutes: int = 60) -> tuple[str, str]:
    """Retorna (html, plain_text)."""
    body = f"""
    <div class="title">Atualizar seu telefone</div>
    <p class="text">Olá, <strong>{name}</strong>!</p>
    <p class="text">
      Um administrador do <strong>Predicts</strong> solicitou a atualização do telefone/WhatsApp da sua conta.
      Clique no botão abaixo para informar o novo número.
    </p>
    <div class="expire">
      ⏱ Este link expira em <strong>{expire_minutes} minutos</strong>
    </div>
    <div class="btn-wrap">
      <a href="{action_url}" class="btn">Atualizar Telefone</a>
    </div>
    <hr class="divider" />
    <p class="text" style="font-size:13px;">
      Se o botão não funcionar, copie e cole o link abaixo no seu navegador:
    </p>
    <div class="link-fallback"><a href="{action_url}">{action_url}</a></div>
    <hr class="divider" />
    <p class="text" style="font-size:12px; color:#5f7790;">
      Se você não esperava este e-mail, ignore-o. Nenhuma alteração é feita sem confirmação.
    </p>
"""
    html = _base_template("Atualizar Telefone — Predicts", body)
    plain = (
        f"Olá, {name}!\n\n"
        f"Um administrador do Predicts solicitou a atualização do telefone da sua conta.\n\n"
        f"Acesse o link abaixo para informar o novo número (válido por {expire_minutes} minutos):\n\n"
        f"{action_url}\n\n"
        f"Se você não esperava este e-mail, ignore-o.\n\n"
        f"— Predicts · predicts.info"
    )
    return html, plain
