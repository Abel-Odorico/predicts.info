"""
Log de erros/checkpoints client-side. Nasceu caçando o crash "problema
ocorreu repetidamente" só em Safari iOS em /apostas e /brasileirao (sem
ErrorBoundary/telemetria no front, um crash nativo do WebKit mata a aba
antes de qualquer JS conseguir reportar o erro em si — checkpoints de
progresso mostram onde morreu mesmo sem log do aparelho) — virou página
permanente em /admin (pedido do Abel), já que o site não tinha NENHUM
error tracking client-side antes disso.

POST /checkpoint e /error são públicos (precisam funcionar até deslogado).
GET /admin/client-diag é admin-only, lê o mesmo arquivo.
Sem tabela — arquivo de log simples com rotação por tamanho (evita crescer
sem limite com tráfego real).
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Query

from auth_utils import require_admin
from models import User

router = APIRouter(tags=["diag"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])

LOG_PATH = Path("/app/client_diag.log")
MAX_BYTES = 5_000_000
KEEP_LINES = 3000


def _rotate_if_needed():
    try:
        if LOG_PATH.exists() and LOG_PATH.stat().st_size > MAX_BYTES:
            lines = LOG_PATH.read_text().splitlines()[-KEEP_LINES:]
            LOG_PATH.write_text("\n".join(lines) + "\n")
    except Exception:
        pass


def _append(kind: str, body: dict, request: Request):
    line = {
        "at": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "ua": request.headers.get("user-agent", ""),
        **body,
    }
    try:
        _rotate_if_needed()
        with LOG_PATH.open("a") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
    except Exception:
        pass
    print(f"[client_diag] {json.dumps(line, ensure_ascii=False)}", flush=True)


@router.post("/diag/checkpoint", status_code=204)
async def checkpoint(request: Request):
    body = await request.json()
    _append("checkpoint", body, request)


@router.post("/diag/error", status_code=204)
async def client_error(request: Request):
    body = await request.json()
    _append("error", body, request)


@admin_router.get("/client-diag")
def list_client_diag(
    kind: str | None = Query(None, description="'error' | 'checkpoint' — sem filtro traz os dois"),
    limit: int = Query(200, le=1000),
    _: User = Depends(require_admin),
):
    if not LOG_PATH.exists():
        return []
    rows = []
    for raw in reversed(LOG_PATH.read_text().splitlines()):
        try:
            row = json.loads(raw)
        except Exception:
            continue
        if kind and row.get("kind") != kind:
            continue
        rows.append(row)
        if len(rows) >= limit:
            break
    return rows
