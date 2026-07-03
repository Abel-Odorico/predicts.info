"""
GET   /admin/news/config      — lista fontes excluídas + stats da última geração
PUT   /admin/news/config      — atualiza lista de fontes excluídas
POST  /admin/news/regenerate  — roda scripts/generate_news_page.py agora (subprocess)
"""
import json
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_utils import require_admin
from models import User

router = APIRouter(tags=["news_admin"])

CONFIG_PATH = Path(__file__).resolve().parent.parent / "news_admin_config.json"
SCRIPT_PATH = "/scripts/generate_news_page.py"


def _load():
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"excluded_sources": [], "last_generated": None, "news_count": 0, "trends_count": 0}


class ExcludedSourcesIn(BaseModel):
    excluded_sources: list[str]


@router.get("/admin/news/config")
def get_news_config(_: User = Depends(require_admin)):
    return _load()


@router.put("/admin/news/config")
def update_news_config(body: ExcludedSourcesIn, _: User = Depends(require_admin)):
    cfg = _load()
    cfg["excluded_sources"] = sorted({s.strip() for s in body.excluded_sources if s.strip()})
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return cfg


@router.post("/admin/news/regenerate")
def regenerate_news(_: User = Depends(require_admin)):
    try:
        result = subprocess.run(
            ["python3", SCRIPT_PATH],
            capture_output=True, text=True, timeout=60,
        )
    except Exception as e:
        raise HTTPException(500, f"Falha ao rodar script: {e}")
    if result.returncode != 0:
        raise HTTPException(500, f"Script falhou: {result.stderr[-500:]}")
    return {"output": result.stdout.strip(), **_load()}
