"""
POST /admin/pwa/icon   — upload novo ícone (PNG, admin)
GET  /admin/pwa/icon   — download ícone atual
"""
import io
import os
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from auth_utils import require_admin
from models import User
from database import get_db

router = APIRouter(tags=["pwa"])

DIST_DIR = "/frontend_dist"
ICON_192  = os.path.join(DIST_DIR, "icon-192.png")
ICON_180  = os.path.join(DIST_DIR, "apple-touch-icon.png")


def _save_icons(data: bytes):
    from PIL import Image
    img = Image.open(io.BytesIO(data)).convert("RGBA")
    img.resize((192, 192), Image.LANCZOS).save(ICON_192, "PNG")
    img.resize((180, 180), Image.LANCZOS).save(ICON_180, "PNG")


@router.post("/admin/pwa/icon", status_code=200)
async def upload_icon(
    file: UploadFile = File(...),
    _: User = Depends(require_admin),
):
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "Arquivo deve ser imagem")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Arquivo muito grande (máx 5MB)")
    try:
        _save_icons(data)
    except Exception as e:
        raise HTTPException(500, f"Erro ao processar imagem: {e}")
    return {"ok": True, "message": "Ícone atualizado"}


@router.get("/admin/pwa/icon")
def download_icon(_: User = Depends(require_admin)):
    if not os.path.exists(ICON_192):
        raise HTTPException(404, "Ícone não encontrado")
    return FileResponse(ICON_192, media_type="image/png", filename="icon-192.png")
