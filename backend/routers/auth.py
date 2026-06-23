import re
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import get_db
from models import User, UserRole, Ranking, PasswordResetToken
from schemas import UserCreate, UserResponse, Token, ProfileUpdate, PasswordChange
from auth_utils import hash_password, verify_password, create_token, get_current_user
from routers.audit import log_action

router = APIRouter(prefix="/auth", tags=["auth"])

# Rate limit: max 10 login attempts per IP per 60s
_login_attempts: dict[str, list[datetime]] = {}
_LOGIN_WINDOW_SEC = 60
_LOGIN_MAX = 10


def _check_login_rate(ip: str) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    cutoff = now - timedelta(seconds=_LOGIN_WINDOW_SEC)
    attempts = [t for t in _login_attempts.get(ip, []) if t > cutoff]
    if len(attempts) >= _LOGIN_MAX:
        raise HTTPException(429, "Too many login attempts — try again in 60 seconds")
    attempts.append(now)
    _login_attempts[ip] = attempts
    # Trim dict to avoid unbounded growth
    if len(_login_attempts) > 10000:
        _login_attempts.clear()

_USERNAME_RE = re.compile(r'^[a-zA-Z0-9_.-]{3,30}$')
_PHONE_RE = re.compile(r'^[0-9+() .-]{10,20}$')


def _normalize_username(value: str | None) -> str | None:
    if value is None:
        return None
    username = value.strip().lower().lstrip('@')
    return username or None


def _normalize_phone(value: str | None) -> str | None:
    if value is None:
        return None
    phone = value.strip()
    return phone or None


def _validate_username(username: str) -> None:
    if not _USERNAME_RE.match(username):
        raise HTTPException(400, "Usuário inválido — use letras, números, _ . - (3–30 chars)")


def _validate_phone(phone: str | None) -> None:
    if phone and not _PHONE_RE.match(phone):
        raise HTTPException(400, "Celular inválido")


def _phone_exists(db: Session, phone: str, exclude_user_id: int | None = None) -> bool:
    query = db.query(User).filter(User.phone == phone)
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    return query.first() is not None


def _username_exists(db: Session, username: str, exclude_user_id: int | None = None) -> bool:
    query = db.query(User).filter(func.lower(User.username) == username.lower())
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    return query.first() is not None


def _username_suggestions(db: Session, username: str, exclude_user_id: int | None = None) -> list[str]:
    base = re.sub(r'[^a-z0-9_.-]', '', username.lower()).strip('._-') or 'usuario'
    base = base[:20]
    candidates = []
    suffixes = ['2026', 'br', 'bolao', 'copa', '10', '7', 'fc', 'pro']
    for suffix in suffixes:
        candidates.append(f"{base}{suffix}")
        candidates.append(f"{base}_{suffix}")
    suggestions = []
    seen = set()
    for candidate in candidates:
        candidate = candidate[:30].strip('._-')
        if candidate in seen or len(candidate) < 3 or not _USERNAME_RE.match(candidate):
            continue
        seen.add(candidate)
        if not _username_exists(db, candidate, exclude_user_id):
            suggestions.append(candidate)
        if len(suggestions) >= 4:
            break
    return suggestions


@router.get("/username/check")
def check_username(
    username: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    normalized = _normalize_username(username)
    if not normalized:
        raise HTTPException(400, "Informe um usuário")
    _validate_username(normalized)
    available = not _username_exists(db, normalized)
    return {
        "username": normalized,
        "available": available,
        "suggestions": [] if available else _username_suggestions(db, normalized),
    }


@router.post("/register", response_model=UserResponse, status_code=201)
def register(payload: UserCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(409, "Email already registered")

    name = payload.name.strip()
    if len(name) < 2:
        raise HTTPException(400, "Nome deve ter ao menos 2 caracteres")

    username = _normalize_username(payload.username)
    if username:
        _validate_username(username)
        if _username_exists(db, username):
            raise HTTPException(409, {
                "message": "Usuário já está em uso",
                "username": username,
                "suggestions": _username_suggestions(db, username),
            })

    phone = _normalize_phone(payload.phone)
    _validate_phone(phone)
    if phone and _phone_exists(db, phone):
        raise HTTPException(409, "Telefone já cadastrado em outra conta")

    user = User(
        email=payload.email,
        username=username,
        phone=phone,
        name=name,
        password_hash=hash_password(payload.password),
        role=UserRole.user,
    )
    db.add(user)
    db.flush()
    db.add(Ranking(user_id=user.id))
    db.commit()
    db.refresh(user)

    try:
        from datetime import datetime, timezone as tz
        from routers.champion import DEADLINE
        from routers.notifications import create_notification
        if datetime.now(tz.utc).replace(tzinfo=None) < DEADLINE:
            create_notification(
                db,
                user_id=user.id,
                type_="champion_remind",
                title="🏆 Escolha o campeão da Copa!",
                body="Acerte o campeão e ganhe +100 pts · prazo: 26/06 às 09h.",
                meta={"url": "/campeao"},
                push=False,
            )
            db.commit()
    except Exception:
        pass

    # Avisa o admin no Telegram (não bloqueia a resposta do cadastro)
    try:
        from routers.report import notify_new_user_telegram
        background_tasks.add_task(notify_new_user_telegram, user.name, user.email, user.username)
    except Exception:
        pass

    return user


@router.post("/login", response_model=Token)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    ip = (
        request.headers.get("X-Real-IP", "").strip()
        or (request.client.host if request.client else "unknown")
    )
    _check_login_rate(ip)
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    token = create_token(user.id, user.role.value)
    log_action(db, user.id, "login", None, ip)
    db.commit()
    return Token(access_token=token, token_type="bearer", user=user)


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/profile", response_model=UserResponse)
def update_profile(
    payload: ProfileUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    changes = {}
    if payload.name is not None:
        name = payload.name.strip()
        if len(name) < 2:
            raise HTTPException(400, "Nome deve ter ao menos 2 caracteres")
        changes["name"] = {"from": user.name, "to": name}
        user.name = name

    if payload.username is not None:
        uname = _normalize_username(payload.username)
        if uname is None:
            changes["username"] = {"from": user.username, "to": None}
            user.username = None
        else:
            _validate_username(uname)
            if _username_exists(db, uname, user.id):
                raise HTTPException(409, {
                    "message": "Usuário já está em uso",
                    "username": uname,
                    "suggestions": _username_suggestions(db, uname, user.id),
                })
            changes["username"] = {"from": user.username, "to": uname}
            user.username = uname

    if payload.phone is not None:
        phone = _normalize_phone(payload.phone)
        _validate_phone(phone)
        if phone and _phone_exists(db, phone, user.id):
            raise HTTPException(409, "Telefone já cadastrado em outra conta")
        changes["phone"] = {"from": user.phone, "to": phone}
        user.phone = phone

    if not changes:
        return user

    db.flush()
    log_action(db, user.id, "profile.update", changes, request.client.host if request.client else None)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/password")
def change_password(
    payload: PasswordChange,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(400, "Senha atual incorreta")
    if len(payload.new_password) < 6:
        raise HTTPException(400, "Nova senha deve ter ao menos 6 caracteres")
    user.password_hash = hash_password(payload.new_password)
    db.flush()
    log_action(db, user.id, "profile.password_change", None, request.client.host if request.client else None)
    db.commit()
    return {"status": "ok", "message": "Senha alterada com sucesso"}


class ThemeUpdate(BaseModel):
    theme: str

@router.patch("/theme", response_model=UserResponse)
def update_theme(
    payload: ThemeUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.theme not in ('light', 'dark', 'system'):
        raise HTTPException(400, "Tema inválido — use light, dark ou system")
    user.theme = payload.theme
    db.commit()
    db.refresh(user)
    return user


# ── Forgot / Reset Password ────────────────────────────────────────────────

_RESET_EXPIRE_MINUTES = 60
_FRONTEND_URL = "https://predicts.info"


class ForgotPasswordPayload(BaseModel):
    email: str


class ResetPasswordPayload(BaseModel):
    token: str
    new_password: str = ""


def _send_reset_email_bg(name: str, email: str, token: str) -> None:
    from mail import send_email, reset_password_html
    url = f"{_FRONTEND_URL}/redefinir-senha?token={token}"
    html, plain = reset_password_html(name, url, _RESET_EXPIRE_MINUTES)
    send_email(email, "Redefinir sua senha — Predicts", html, plain)


@router.post("/forgot-password", status_code=202)
def forgot_password(
    payload: ForgotPasswordPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    # Sempre retorna 202 para não vazar se e-mail existe
    user = db.query(User).filter(func.lower(User.email) == payload.email.strip().lower()).first()
    if not user:
        return {"status": "ok", "message": "Se o e-mail existir, um link será enviado."}

    # Invalida tokens anteriores não usados
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
    ).delete()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    token = secrets.token_urlsafe(48)
    db.add(PasswordResetToken(
        user_id=user.id,
        token=token,
        expires_at=now + timedelta(minutes=_RESET_EXPIRE_MINUTES),
    ))
    db.commit()

    background_tasks.add_task(_send_reset_email_bg, user.name, user.email, token)
    return {"status": "ok", "message": "Se o e-mail existir, um link será enviado."}


@router.get("/reset-password/validate")
def validate_reset_token(token: str = Query(...), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rec = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == token,
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.expires_at > now,
    ).first()
    if not rec:
        raise HTTPException(400, "Link inválido ou expirado")
    return {"valid": True, "email": rec.user.email if rec.user else None}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordPayload, db: Session = Depends(get_db)):
    if len(payload.new_password) < 6:
        raise HTTPException(400, "Nova senha deve ter ao menos 6 caracteres")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rec = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == payload.token,
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.expires_at > now,
    ).first()
    if not rec:
        raise HTTPException(400, "Link inválido ou expirado")

    user = db.query(User).filter(User.id == rec.user_id).first()
    if not user:
        raise HTTPException(404, "Usuário não encontrado")

    user.password_hash = hash_password(payload.new_password)
    rec.used_at = now
    db.commit()
    return {"status": "ok", "message": "Senha redefinida com sucesso"}
