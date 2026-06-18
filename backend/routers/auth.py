import re
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from database import get_db
from models import User, UserRole, Ranking
from schemas import UserCreate, UserResponse, Token, ProfileUpdate, PasswordChange
from auth_utils import hash_password, verify_password, create_token, get_current_user
from routers.audit import log_action

router = APIRouter(prefix="/auth", tags=["auth"])

_USERNAME_RE = re.compile(r'^[a-zA-Z0-9_.-]{3,30}$')


@router.post("/register", response_model=UserResponse, status_code=201)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(409, "Email already registered")
    user = User(
        email=payload.email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        role=UserRole.user,
    )
    db.add(user)
    db.flush()
    db.add(Ranking(user_id=user.id))
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    token = create_token(user.id, user.role.value)
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
        uname = payload.username.strip()
        if uname == "":
            user.username = None
        else:
            if not _USERNAME_RE.match(uname):
                raise HTTPException(400, "Username inválido — use letras, números, _ . - (3–30 chars)")
            conflict = db.query(User).filter(User.username == uname, User.id != user.id).first()
            if conflict:
                raise HTTPException(409, "Username já em uso")
            changes["username"] = {"from": user.username, "to": uname}
            user.username = uname

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
