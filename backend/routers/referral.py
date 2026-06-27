"""
GET  /me/referral  — authenticated: referral link + invited count
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from auth_utils import get_current_user
from models import User

router = APIRouter(tags=["referral"])


@router.get("/me/referral")
def my_referral(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    invited = db.query(User).filter(User.referred_by == user.id).count()
    return {
        "user_id": user.id,
        "invite_url": f"https://predicts.info?ref={user.id}",
        "invited_count": invited,
    }
