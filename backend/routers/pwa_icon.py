"""
POST /admin/pwa/icon   — upload novo ícone, gera todos os tamanhos
GET  /admin/pwa/icon   — download ícone atual (192px)
"""
import io
import os
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

from auth_utils import require_admin
from models import User

router = APIRouter(tags=["pwa"])

DIST = "/frontend_dist"

SIZES = {
    "icon-512.png":          (512, 512, "PNG"),
    "icon-192.png":          (192, 192, "PNG"),
    "apple-touch-icon.png":  (180, 180, "PNG"),
    "favicon-32x32.png":     (32,  32,  "PNG"),
    "favicon-16x16.png":     (16,  16,  "PNG"),
    "favicon.ico":           (None, None, "ICO"),
}


def _save_icons(data: bytes):
    from PIL import Image
    img = Image.open(io.BytesIO(data)).convert("RGBA")

    for filename, (w, h, fmt) in SIZES.items():
        path = os.path.join(DIST, filename)
        if fmt == "ICO":
            ico = img.copy()
            ico.thumbnail((64, 64), Image.LANCZOS)
            ico.save(path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
        else:
            resized = img.resize((w, h), Image.LANCZOS)
            if fmt == "PNG":
                resized.save(path, "PNG")
            else:
                resized.convert("RGB").save(path, fmt)


@router.post("/admin/pwa/icon", status_code=200)
async def upload_icon(
    file: UploadFile = File(...),
    _: User = Depends(require_admin),
):
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "Arquivo deve ser imagem")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "Arquivo muito grande (máx 10MB)")
    try:
        _save_icons(data)
    except Exception as e:
        raise HTTPException(500, f"Erro ao processar imagem: {e}")
    return {"ok": True, "sizes": list(SIZES.keys())}


@router.get("/admin/pwa/icon")
def download_icon(_: User = Depends(require_admin)):
    path = os.path.join(DIST, "icon-192.png")
    if not os.path.exists(path):
        raise HTTPException(404, "Ícone não encontrado")
    return FileResponse(path, media_type="image/png", filename="icon-192.png")
