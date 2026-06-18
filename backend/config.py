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
    auto_sync_interval_hours: int = 6

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
