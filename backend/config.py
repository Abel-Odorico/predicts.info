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

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
