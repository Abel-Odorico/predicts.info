from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://copa:copa@db:5432/copa2026"
    redis_url: str = "redis://redis:6379/0"
    jwt_secret: str = "dev_secret_change_in_production"
    jwt_expire_days: int = 7
    mc_simulations: int = 1_000_000
    odds_api_key: str = ""
    odds_enabled: bool = False
    fg_sports_url: str = "https://fg.peepstreaming.com/copa-do-mundo-2026"
    auto_sync_interval_hours: float = 6

    # SMTP
    mail_enabled: bool = False
    mail_host: str = "smtp.gmail.com"
    mail_port: int = 587
    mail_username: str = ""
    mail_password: str = ""
    mail_encryption: str = "tls"
    mail_timeout: int = 15
    mail_from_address: str = ""
    mail_from_name: str = "Predicts"

    # Web Push (VAPID)
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_claims_email: str = "noreplypeep@gmail.com"

    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # Oráculo Predictor (bot re-análise pré-jogo)
    oracle_enabled: bool = True
    oracle_window_minutes: int = 60      # quão perto do jogo dispara (≈1h antes)
    oracle_loop_minutes: int = 10        # frequência de verificação do cron

    # Slack — canal de notificação do Oráculo (Incoming Webhook)
    slack_webhook_url: str = ""
    oracle_slack_enabled: bool = True

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()

# Falha hard se valores sensíveis ficaram no default (ex.: .env não carregou)
_INSECURE_DEFAULTS = {
    "jwt_secret": "dev_secret_change_in_production",
    "database_url": "postgresql://copa:copa@db:5432/copa2026",
}
for _field, _default in _INSECURE_DEFAULTS.items():
    if getattr(settings, _field) == _default:
        raise RuntimeError(
            f"Config insegura: '{_field}' está no valor padrão. "
            f"Defina via .env antes de subir o serviço."
        )
