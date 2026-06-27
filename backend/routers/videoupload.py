"""
POST /api/video/upload  — recebe vídeo para edição (token protegido)
GET  /api/video/status  — lista uploads recentes
"""
import shutil, time
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Header, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from routers.config import _get_all

router = APIRouter(tags=["video"])

UPLOAD_DIR = Path("/tmp/predicts_uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


def _token_ok(x_token: str | None, db: Session) -> bool:
    if not x_token:
        return False
    expected = _get_all(db).get("video_upload_token", "")
    return bool(expected) and x_token == expected


@router.post("/video/upload")
async def upload_video(
    file: UploadFile = File(...),
    x_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if not _token_ok(x_token, db):
        raise HTTPException(401, "Token inválido")

    ext = Path(file.filename or "video.mp4").suffix or ".mp4"
    allowed = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
    if ext.lower() not in allowed:
        raise HTTPException(400, f"Formato não suportado: {ext}")

    ts   = int(time.time())
    name = f"upload_{ts}{ext}"
    dest = UPLOAD_DIR / name

    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    size = dest.stat().st_size
    return {
        "ok": True,
        "file": str(dest),
        "name": name,
        "size_mb": round(size / 1024 / 1024, 2),
        "message": "Upload recebido. Peça ao Claude para processar o arquivo.",
    }


@router.get("/video/status")
async def video_status(
    x_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if not _token_ok(x_token, db):
        raise HTTPException(401, "Token inválido")

    files = []
    for f in sorted(UPLOAD_DIR.glob("upload_*"), key=lambda x: x.stat().st_mtime, reverse=True)[:5]:
        files.append({
            "name": f.name,
            "path": str(f),
            "size_mb": round(f.stat().st_size / 1024 / 1024, 2),
            "mtime": int(f.stat().st_mtime),
        })
    return {"uploads": files}
