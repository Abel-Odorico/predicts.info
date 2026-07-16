"""
Log de erros client-side. Site não tinha nenhum error tracking client-side —
window.onerror/unhandledrejection do front (frontend/src/diag.js) manda pra
cá via sendBeacon, sobrevive a unload/fechamento de aba.

POST /diag/error é público (precisa funcionar até deslogado).
GET /admin/client-diag é admin-only, lê o mesmo arquivo — página /admin/logs.
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


@router.post("/diag/error", status_code=204)
async def client_error(request: Request):
    body = await request.json()
    line = {
        "at": datetime.now(timezone.utc).isoformat(),
        "kind": "error",
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


@admin_router.get("/client-diag")
def list_client_diag(
    limit: int = Query(200, le=1000),
    _: User = Depends(require_admin),
):
    if not LOG_PATH.exists():
        return []
    rows = []
    for raw in reversed(LOG_PATH.read_text().splitlines()):
        try:
            rows.append(json.loads(raw))
        except Exception:
            continue
        if len(rows) >= limit:
            break
    return rows
