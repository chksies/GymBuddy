from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.concurrency import run_in_threadpool
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ConnectionFailure, DuplicateKeyError
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Literal, Optional
import uuid
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
import random
import re
import string
import asyncio

ROOT_DIR = Path(__file__).parent
# Must run before importing local modules that read configuration from the environment.
load_dotenv(ROOT_DIR / '.env')

from push import send_push_notifications, build_message
from storage import (
    save_image, delete_media, put_media, detect_type, MEDIA_URL_PREFIX, LEGACY_UPLOAD_DIR, LEGACY_URL_PREFIX,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def utcnow() -> datetime:
    """Timezone-aware, so API timestamps carry a UTC marker and clients don't misread them as local time."""
    return datetime.now(timezone.utc)

# MongoDB connection. Fail fast when the database is down instead of hanging every request for 30s.
# tz_aware makes stored timestamps (always UTC in BSON) come back timezone-aware too.
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000, tz_aware=True)
db = client[os.environ.get('DB_NAME', 'gymbuddy_db')]

# JWT Configuration. The secret signs everyone's logins; a fresh clone without one falls back to a
# built-in key so it still runs.
JWT_SECRET = os.environ.get('JWT_SECRET', '')
if not JWT_SECRET:
    JWT_SECRET = 'gymbuddy_secret_key_2025'
    logger.warning("JWT_SECRET is not set - using the built-in development key. Set one in backend/.env.")
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

# Reactions
ALLOWED_REACTIONS = {"🔥", "💪", "👏", "😮"}

# Streaks stay alive while both friends check in within this many days of each other
STREAK_GRACE_DAYS = 3

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,30}$")

# Security
security = HTTPBearer()

# Create the main app
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

@app.exception_handler(ConnectionFailure)
async def database_error_handler(request: Request, exc: ConnectionFailure):
    logger.error(f"Database error on {request.method} {request.url.path}: {exc}")
    return JSONResponse(
        status_code=503,
        content={"detail": "The database is unavailable right now. Make sure MongoDB is running."},
    )

# ========================= MODELS =========================

class UserCreate(BaseModel):
    email: str
    password: str
    username: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    friend_code: str
    profile_pic: Optional[str] = None
    created_at: datetime

class UserProfile(BaseModel):
    username: Optional[str] = None
    profile_pic: Optional[str] = None

class PostCreate(BaseModel):
    image: str  # base64 encoded image
    caption: Optional[str] = Field("", max_length=500)

class PostResponse(BaseModel):
    id: str
    user_id: str
    username: str
    profile_pic: Optional[str] = None
    image: str
    caption: str
    created_at: datetime
    reaction_counts: dict = {}
    my_reaction: Optional[str] = None

class ReactionCreate(BaseModel):
    emoji: str

class FriendRequest(BaseModel):
    friend_code: str

class FriendshipResponse(BaseModel):
    id: str
    friend_id: str
    friend_username: str
    friend_profile_pic: Optional[str] = None
    status: str
    streak_count: int
    last_mutual_post: Optional[datetime] = None
    is_requester: bool

class WorkoutExercise(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sets: Optional[int] = Field(None, ge=0, le=1000)
    reps: Optional[str] = Field(None, max_length=50)
    weight: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = Field(None, max_length=500)

class WorkoutCreate(BaseModel):
    workout_type: Literal["text", "structured"]
    title: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field("", max_length=2000)
    exercises: Optional[List[WorkoutExercise]] = Field(default_factory=list, max_length=50)

class WorkoutResponse(BaseModel):
    id: str
    user_id: str
    username: str
    profile_pic: Optional[str] = None
    workout_type: str
    title: str
    description: str
    exercises: List[dict]
    created_at: datetime

# ========================= AUTH HELPERS =========================

def generate_friend_code() -> str:
    """Generate a unique 6-character friend code"""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str) -> str:
    payload = {
        'user_id': user_id,
        'exp': utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get('user_id')
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ========================= NOTIFICATION HELPERS =========================

async def get_notification_pref(user_id: str, key: str) -> bool:
    """Notification settings default to on until a user explicitly changes them."""
    settings = await db.notification_settings.find_one({"user_id": user_id})
    if not settings:
        return True
    return settings.get(key, True)

async def notify_user(user_id: str, setting_key: str, title: str, body: str, data: Optional[dict] = None):
    user = await db.users.find_one({"id": user_id})
    if not user or not user.get("push_token"):
        return
    if not await get_notification_pref(user_id, setting_key):
        return
    await send_push_notifications([build_message(user["push_token"], title, body, data)])

# ========================= AUTH ENDPOINTS =========================

@api_router.post("/auth/register")
async def register(user_data: UserCreate):
    email = user_data.email.strip().lower()
    username = user_data.username.strip().lower()

    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3-30 characters: letters, numbers, dots or underscores",
        )
    if len(user_data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # Check if email exists
    existing_email = await db.users.find_one({"email": email})
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Check if username exists
    existing_username = await db.users.find_one({"username": username})
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already taken")

    # Generate unique friend code
    friend_code = generate_friend_code()
    while await db.users.find_one({"friend_code": friend_code}):
        friend_code = generate_friend_code()

    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": await run_in_threadpool(hash_password, user_data.password),
        "username": username,
        "friend_code": friend_code,
        "profile_pic": None,
        "created_at": utcnow()
    }

    try:
        await db.users.insert_one(user)
    except DuplicateKeyError:
        # Two sign-ups raced past the checks above; the unique indexes caught it.
        raise HTTPException(status_code=400, detail="That email or username is already taken")
    token = create_token(user["id"])
    
    return {
        "token": token,
        "user": UserResponse(
            id=user["id"],
            email=user["email"],
            username=user["username"],
            friend_code=user["friend_code"],
            profile_pic=user["profile_pic"],
            created_at=user["created_at"]
        )
    }

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email.strip().lower()})
    if not user or not await run_in_threadpool(verify_password, credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    token = create_token(user["id"])
    
    return {
        "token": token,
        "user": UserResponse(
            id=user["id"],
            email=user["email"],
            username=user["username"],
            friend_code=user["friend_code"],
            profile_pic=user.get("profile_pic"),
            created_at=user["created_at"]
        )
    }

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        username=current_user["username"],
        friend_code=current_user["friend_code"],
        profile_pic=current_user.get("profile_pic"),
        created_at=current_user["created_at"]
    )

@api_router.put("/auth/profile")
async def update_profile(profile: UserProfile, current_user: dict = Depends(get_current_user)):
    update_data = {}
    
    if profile.username:
        new_username = profile.username.strip().lower()
        if not USERNAME_RE.match(new_username):
            raise HTTPException(
                status_code=400,
                detail="Username must be 3-30 characters: letters, numbers, dots or underscores",
            )
        # Check if username is taken by another user
        existing = await db.users.find_one({
            "username": new_username,
            "id": {"$ne": current_user["id"]}
        })
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
        update_data["username"] = new_username

    if profile.profile_pic is not None:
        update_data["profile_pic"] = await save_image(db, profile.profile_pic, f"profile/{current_user['id']}")

    if update_data:
        try:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$set": update_data}
            )
        except DuplicateKeyError:
            if "profile_pic" in update_data:
                await delete_media(db, update_data["profile_pic"])  # don't leave the new photo orphaned
            raise HTTPException(status_code=400, detail="Username already taken")
        if "profile_pic" in update_data:
            await delete_media(db, current_user.get("profile_pic"))  # the photo this one replaces
    
    updated_user = await db.users.find_one({"id": current_user["id"]})
    return UserResponse(
        id=updated_user["id"],
        email=updated_user["email"],
        username=updated_user["username"],
        friend_code=updated_user["friend_code"],
        profile_pic=updated_user.get("profile_pic"),
        created_at=updated_user["created_at"]
    )

# ========================= POSTS ENDPOINTS =========================

@api_router.post("/posts")
async def create_post(post_data: PostCreate, current_user: dict = Depends(get_current_user)):
    image_url = await save_image(db, post_data.image, f"posts/{current_user['id']}")

    post = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "image": image_url,
        "caption": post_data.caption or "",
        "created_at": utcnow()
    }
    
    await db.posts.insert_one(post)

    # Update streaks with all friends
    await update_streaks_for_user(current_user["id"])
    await notify_friends_of_post(current_user)

    return PostResponse(
        id=post["id"],
        user_id=post["user_id"],
        username=current_user["username"],
        profile_pic=current_user.get("profile_pic"),
        image=post["image"],
        caption=post["caption"],
        created_at=post["created_at"],
        reaction_counts={},
        my_reaction=None
    )

async def get_reactions_summary(post_ids: List[str], viewer_id: str) -> dict:
    """Returns {post_id: {"counts": {emoji: n}, "my_reaction": str|None}} for the given posts."""
    summary = {pid: {"counts": {}, "my_reaction": None} for pid in post_ids}
    if not post_ids:
        return summary

    reactions = await db.reactions.find({"post_id": {"$in": post_ids}}).to_list(10000)
    for r in reactions:
        entry = summary[r["post_id"]]
        entry["counts"][r["emoji"]] = entry["counts"].get(r["emoji"], 0) + 1
        if r["user_id"] == viewer_id:
            entry["my_reaction"] = r["emoji"]

    return summary

async def get_friend_ids(user_id: str) -> List[str]:
    friendships = await db.friendships.find({
        "status": "accepted",
        "$or": [{"user1_id": user_id}, {"user2_id": user_id}]
    }).to_list(1000)
    return [f["user2_id"] if f["user1_id"] == user_id else f["user1_id"] for f in friendships]

async def get_users_by_id(user_ids) -> dict:
    users = await db.users.find({"id": {"$in": list(user_ids)}}).to_list(1000)
    return {u["id"]: u for u in users}

@api_router.get("/posts/feed")
async def get_feed(current_user: dict = Depends(get_current_user)):
    # Posts from friends and the user's own
    visible_ids = await get_friend_ids(current_user["id"]) + [current_user["id"]]
    posts = await db.posts.find({
        "user_id": {"$in": visible_ids}
    }).sort("created_at", -1).to_list(100)

    authors = await get_users_by_id({p["user_id"] for p in posts})
    reactions_by_post = await get_reactions_summary([p["id"] for p in posts], current_user["id"])

    result = []
    for post in posts:
        user = authors.get(post["user_id"])
        if user:
            reactions = reactions_by_post[post["id"]]
            result.append(PostResponse(
                id=post["id"],
                user_id=post["user_id"],
                username=user["username"],
                profile_pic=user.get("profile_pic"),
                image=post["image"],
                caption=post["caption"],
                created_at=post["created_at"],
                reaction_counts=reactions["counts"],
                my_reaction=reactions["my_reaction"]
            ))

    return result

@api_router.get("/posts/my")
async def get_my_posts(current_user: dict = Depends(get_current_user)):
    posts = await db.posts.find({
        "user_id": current_user["id"]
    }).sort("created_at", -1).to_list(100)

    reactions_by_post = await get_reactions_summary([p["id"] for p in posts], current_user["id"])

    return [PostResponse(
        id=post["id"],
        user_id=post["user_id"],
        username=current_user["username"],
        profile_pic=current_user.get("profile_pic"),
        image=post["image"],
        caption=post["caption"],
        created_at=post["created_at"],
        reaction_counts=reactions_by_post[post["id"]]["counts"],
        my_reaction=reactions_by_post[post["id"]]["my_reaction"]
    ) for post in posts]

@api_router.post("/posts/{post_id}/react")
async def react_to_post(post_id: str, reaction: ReactionCreate, current_user: dict = Depends(get_current_user)):
    if reaction.emoji not in ALLOWED_REACTIONS:
        raise HTTPException(status_code=400, detail="Unsupported reaction")

    post = await db.posts.find_one({"id": post_id})
    # Posts from non-friends aren't visible to this user, so they shouldn't be reactable either.
    if not post or (
        post["user_id"] != current_user["id"]
        and post["user_id"] not in await get_friend_ids(current_user["id"])
    ):
        raise HTTPException(status_code=404, detail="Post not found")

    await db.reactions.update_one(
        {"post_id": post_id, "user_id": current_user["id"]},
        {"$set": {
            "post_id": post_id,
            "user_id": current_user["id"],
            "emoji": reaction.emoji,
            "created_at": utcnow()
        }},
        upsert=True
    )

    if post["user_id"] != current_user["id"]:
        await notify_user(
            post["user_id"], "friend_posts",
            "GymBuddy",
            f"@{current_user['username']} reacted {reaction.emoji} to your check-in",
            {"type": "post_reaction", "post_id": post_id}
        )

    summary = await get_reactions_summary([post_id], current_user["id"])
    return summary[post_id]

@api_router.delete("/posts/{post_id}/react")
async def remove_reaction(post_id: str, current_user: dict = Depends(get_current_user)):
    await db.reactions.delete_one({"post_id": post_id, "user_id": current_user["id"]})
    summary = await get_reactions_summary([post_id], current_user["id"])
    return summary[post_id]

async def notify_friends_of_post(poster: dict):
    """Ping every accepted friend (who has friend_posts notifications on) that poster just checked in."""
    friendships = await db.friendships.find({
        "$or": [
            {"user1_id": poster["id"], "status": "accepted"},
            {"user2_id": poster["id"], "status": "accepted"}
        ]
    }).to_list(1000)

    messages = []
    for f in friendships:
        friend_id = f["user2_id"] if f["user1_id"] == poster["id"] else f["user1_id"]
        friend = await db.users.find_one({"id": friend_id})
        if not friend or not friend.get("push_token"):
            continue
        if not await get_notification_pref(friend_id, "friend_posts"):
            continue
        messages.append(build_message(
            friend["push_token"],
            "GymBuddy",
            f"@{poster['username']} just checked in 💪",
            {"type": "friend_post", "user_id": poster["id"]}
        ))

    if messages:
        await send_push_notifications(messages)

# ========================= FRIENDS ENDPOINTS =========================

@api_router.post("/friends/request")
async def send_friend_request(request: FriendRequest, current_user: dict = Depends(get_current_user)):
    # Find user by friend code
    friend = await db.users.find_one({"friend_code": request.friend_code.upper()})
    if not friend:
        raise HTTPException(status_code=404, detail="Friend code not found")
    
    if friend["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot add yourself as a friend")
    
    # Check if friendship already exists
    existing = await db.friendships.find_one({
        "$or": [
            {"user1_id": current_user["id"], "user2_id": friend["id"]},
            {"user1_id": friend["id"], "user2_id": current_user["id"]}
        ]
    })
    
    if existing:
        if existing["status"] == "accepted":
            raise HTTPException(status_code=400, detail="Already friends")
        elif existing["status"] == "pending":
            if existing["user2_id"] == current_user["id"]:
                raise HTTPException(
                    status_code=400,
                    detail="They already sent you a request - accept it in the Requests tab",
                )
            raise HTTPException(status_code=400, detail="Friend request already pending")
    
    friendship = {
        "id": str(uuid.uuid4()),
        "user1_id": current_user["id"],  # Requester
        "user2_id": friend["id"],  # Recipient
        "status": "pending",
        "streak_count": 0,
        "last_mutual_post": None,
        "created_at": utcnow()
    }
    
    await db.friendships.insert_one(friendship)

    await notify_user(
        friend["id"], "friend_requests",
        "GymBuddy",
        f"@{current_user['username']} sent you a friend request",
        {"type": "friend_request", "friendship_id": friendship["id"]}
    )

    return {"message": "Friend request sent", "friendship_id": friendship["id"]}

@api_router.get("/friends/search/{query}")
async def search_users(query: str, current_user: dict = Depends(get_current_user)):
    # Search by username or friend code. The query is user input, so it must be escaped before
    # being used as a regex - otherwise characters like "(" or "[" make the search fail.
    query = query.strip()
    users = await db.users.find({
        "$or": [
            {"username": {"$regex": re.escape(query.lower()), "$options": "i"}},
            {"friend_code": query.upper()}
        ],
        "id": {"$ne": current_user["id"]}
    }).to_list(20)
    
    result = []
    for user in users:
        # Check friendship status
        friendship = await db.friendships.find_one({
            "$or": [
                {"user1_id": current_user["id"], "user2_id": user["id"]},
                {"user1_id": user["id"], "user2_id": current_user["id"]}
            ]
        })
        
        status = "none"
        if friendship:
            status = friendship["status"]
        
        result.append({
            "id": user["id"],
            "username": user["username"],
            "friend_code": user["friend_code"],
            "profile_pic": user.get("profile_pic"),
            "friendship_status": status
        })
    
    return result

@api_router.get("/friends")
async def get_friends(current_user: dict = Depends(get_current_user)):
    friendships = await db.friendships.find({
        "$or": [
            {"user1_id": current_user["id"], "status": "accepted"},
            {"user2_id": current_user["id"], "status": "accepted"}
        ]
    }).to_list(1000)
    
    today = utcnow().date()
    result = []
    for f in friendships:
        friend_id = f["user2_id"] if f["user1_id"] == current_user["id"] else f["user1_id"]
        friend = await db.users.find_one({"id": friend_id})

        if friend:
            result.append(FriendshipResponse(
                id=f["id"],
                friend_id=friend["id"],
                friend_username=friend["username"],
                friend_profile_pic=friend.get("profile_pic"),
                status=f["status"],
                streak_count=current_streak(f, today),
                last_mutual_post=f.get("last_mutual_post"),
                is_requester=f["user1_id"] == current_user["id"]
            ))
    
    return result

@api_router.get("/friends/requests")
async def get_friend_requests(current_user: dict = Depends(get_current_user)):
    # Get pending requests where current user is the recipient
    friendships = await db.friendships.find({
        "user2_id": current_user["id"],
        "status": "pending"
    }).to_list(100)
    
    result = []
    for f in friendships:
        requester = await db.users.find_one({"id": f["user1_id"]})
        if requester:
            result.append({
                "id": f["id"],
                "requester_id": requester["id"],
                "requester_username": requester["username"],
                "requester_profile_pic": requester.get("profile_pic"),
                "created_at": f["created_at"]
            })
    
    return result

@api_router.post("/friends/accept/{friendship_id}")
async def accept_friend_request(friendship_id: str, current_user: dict = Depends(get_current_user)):
    friendship = await db.friendships.find_one({
        "id": friendship_id,
        "user2_id": current_user["id"],
        "status": "pending"
    })
    
    if not friendship:
        raise HTTPException(status_code=404, detail="Friend request not found")
    
    await db.friendships.update_one(
        {"id": friendship_id},
        {"$set": {"status": "accepted"}}
    )

    await notify_user(
        friendship["user1_id"], "friend_requests",
        "GymBuddy",
        f"@{current_user['username']} accepted your friend request",
        {"type": "friend_request_accepted", "friendship_id": friendship_id}
    )

    return {"message": "Friend request accepted"}

@api_router.post("/friends/decline/{friendship_id}")
async def decline_friend_request(friendship_id: str, current_user: dict = Depends(get_current_user)):
    friendship = await db.friendships.find_one({
        "id": friendship_id,
        "user2_id": current_user["id"],
        "status": "pending"
    })
    
    if not friendship:
        raise HTTPException(status_code=404, detail="Friend request not found")
    
    await db.friendships.delete_one({"id": friendship_id})
    
    return {"message": "Friend request declined"}

@api_router.delete("/friends/{friend_id}")
async def remove_friend(friend_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.friendships.delete_one({
        "$or": [
            {"user1_id": current_user["id"], "user2_id": friend_id},
            {"user1_id": friend_id, "user2_id": current_user["id"]}
        ]
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Friendship not found")
    
    return {"message": "Friend removed"}

# ========================= STREAKS LOGIC =========================

def _as_date(value):
    return value.date() if isinstance(value, datetime) else value

def streak_is_active(friendship: dict, today) -> bool:
    last_mutual = friendship.get("last_mutual_post")
    return bool(last_mutual) and (today - _as_date(last_mutual)).days <= STREAK_GRACE_DAYS

def current_streak(friendship: dict, today) -> int:
    """The stored count only means something while the streak is alive; an expired streak is 0."""
    return friendship.get("streak_count", 0) if streak_is_active(friendship, today) else 0

async def update_streaks_for_user(user_id: str):
    """Update streaks when a user posts"""
    today = utcnow().date()

    # Get all accepted friendships
    friendships = await db.friendships.find({
        "$or": [
            {"user1_id": user_id, "status": "accepted"},
            {"user2_id": user_id, "status": "accepted"}
        ]
    }).to_list(1000)

    for friendship in friendships:
        friend_id = friendship["user2_id"] if friendship["user1_id"] == user_id else friendship["user1_id"]

        # Check if friend also posted today
        friend_post_today = await db.posts.find_one({
            "user_id": friend_id,
            "created_at": {
                "$gte": datetime.combine(today, datetime.min.time()),
                "$lt": datetime.combine(today + timedelta(days=1), datetime.min.time())
            }
        })

        if friend_post_today:
            # Both posted today - update streak
            last_mutual = friendship.get("last_mutual_post")
            if last_mutual and _as_date(last_mutual) == today:
                continue  # today's mutual check-in is already counted; extra posts don't inflate it

            if streak_is_active(friendship, today):
                new_streak = friendship.get("streak_count", 0) + 1
            else:
                # First mutual post, or the streak lapsed - start over
                new_streak = 1

            await db.friendships.update_one(
                {"id": friendship["id"]},
                {"$set": {
                    "streak_count": new_streak,
                    "best_streak": max(friendship.get("best_streak", 0), new_streak),
                    "last_mutual_post": utcnow()
                }}
            )

@api_router.get("/streaks")
async def get_streaks(current_user: dict = Depends(get_current_user)):
    """Get all streaks with friends"""
    friendships = await db.friendships.find({
        "$or": [
            {"user1_id": current_user["id"], "status": "accepted"},
            {"user2_id": current_user["id"], "status": "accepted"}
        ]
    }).to_list(1000)
    
    result = []
    today = utcnow().date()
    
    for f in friendships:
        friend_id = f["user2_id"] if f["user1_id"] == current_user["id"] else f["user1_id"]
        friend = await db.users.find_one({"id": friend_id})
        
        if friend:
            last_mutual = f.get("last_mutual_post")
            streak_active = streak_is_active(f, today)
            days_remaining = (
                STREAK_GRACE_DAYS - (today - _as_date(last_mutual)).days if streak_active else 0
            )
            
            # Check if user posted today
            user_posted_today = await db.posts.find_one({
                "user_id": current_user["id"],
                "created_at": {
                    "$gte": datetime.combine(today, datetime.min.time()),
                    "$lt": datetime.combine(today + timedelta(days=1), datetime.min.time())
                }
            }) is not None
            
            # Check if friend posted today
            friend_posted_today = await db.posts.find_one({
                "user_id": friend_id,
                "created_at": {
                    "$gte": datetime.combine(today, datetime.min.time()),
                    "$lt": datetime.combine(today + timedelta(days=1), datetime.min.time())
                }
            }) is not None
            
            result.append({
                "friendship_id": f["id"],
                "friend_id": friend["id"],
                "friend_username": friend["username"],
                "friend_profile_pic": friend.get("profile_pic"),
                "streak_count": current_streak(f, today),
                "streak_active": streak_active,
                "days_remaining": days_remaining,
                "user_posted_today": user_posted_today,
                "friend_posted_today": friend_posted_today,
                "last_mutual_post": last_mutual
            })
    
    return result

async def send_streak_warnings():
    """Warn both friends when a streak has exactly one day left and one of them hasn't posted today."""
    today = utcnow().date()
    friendships = await db.friendships.find({
        "status": "accepted",
        "streak_count": {"$gt": 0}
    }).to_list(10000)

    for f in friendships:
        last_mutual = f.get("last_mutual_post")
        if not last_mutual:
            continue
        days_diff = (today - _as_date(last_mutual)).days

        # days_remaining = STREAK_GRACE_DAYS - days_diff (see /streaks) - warn with exactly 1 day left
        if days_diff != STREAK_GRACE_DAYS - 1:
            continue
        if f.get("last_streak_warning_date") == today.isoformat():
            continue  # already warned today

        user1 = await db.users.find_one({"id": f["user1_id"]})
        user2 = await db.users.find_one({"id": f["user2_id"]})
        if not user1 or not user2:
            continue

        for user, other in [(user1, user2), (user2, user1)]:
            posted_today = await db.posts.find_one({
                "user_id": user["id"],
                "created_at": {
                    "$gte": datetime.combine(today, datetime.min.time()),
                    "$lt": datetime.combine(today + timedelta(days=1), datetime.min.time())
                }
            }) is not None
            if posted_today:
                continue
            await notify_user(
                user["id"], "streak_warnings",
                "Streak about to expire! 🔥",
                f"Post today to keep your {f['streak_count']}-day streak with @{other['username']} alive",
                {"type": "streak_warning", "friendship_id": f["id"]}
            )

        await db.friendships.update_one(
            {"id": f["id"]},
            {"$set": {"last_streak_warning_date": today.isoformat()}}
        )

async def streak_warning_scheduler():
    """Sweep for at-risk streaks on startup, then every 6 hours."""
    while True:
        try:
            await send_streak_warnings()
        except Exception as exc:
            logger.warning(f"Streak warning sweep failed: {exc}")
        await asyncio.sleep(6 * 60 * 60)

# ========================= WORKOUTS ENDPOINTS =========================

@api_router.post("/workouts")
async def create_workout(workout_data: WorkoutCreate, current_user: dict = Depends(get_current_user)):
    title = workout_data.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Please enter a title")

    workout = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "workout_type": workout_data.workout_type,
        "title": title,
        "description": workout_data.description or "",
        "exercises": [e.dict() for e in (workout_data.exercises or [])],
        "created_at": utcnow()
    }
    
    await db.workouts.insert_one(workout)
    
    return WorkoutResponse(
        id=workout["id"],
        user_id=workout["user_id"],
        username=current_user["username"],
        profile_pic=current_user.get("profile_pic"),
        workout_type=workout["workout_type"],
        title=workout["title"],
        description=workout["description"],
        exercises=workout["exercises"],
        created_at=workout["created_at"]
    )

@api_router.get("/workouts/feed")
async def get_workouts_feed(current_user: dict = Depends(get_current_user)):
    # Workouts from friends and the user's own
    visible_ids = await get_friend_ids(current_user["id"]) + [current_user["id"]]
    workouts = await db.workouts.find({
        "user_id": {"$in": visible_ids}
    }).sort("created_at", -1).to_list(100)

    authors = await get_users_by_id({w["user_id"] for w in workouts})

    result = []
    for workout in workouts:
        user = authors.get(workout["user_id"])
        if user:
            result.append(WorkoutResponse(
                id=workout["id"],
                user_id=workout["user_id"],
                username=user["username"],
                profile_pic=user.get("profile_pic"),
                workout_type=workout["workout_type"],
                title=workout["title"],
                description=workout["description"],
                exercises=workout.get("exercises", []),
                created_at=workout["created_at"]
            ))
    
    return result

@api_router.get("/workouts/my")
async def get_my_workouts(current_user: dict = Depends(get_current_user)):
    workouts = await db.workouts.find({
        "user_id": current_user["id"]
    }).sort("created_at", -1).to_list(100)
    
    return [WorkoutResponse(
        id=workout["id"],
        user_id=workout["user_id"],
        username=current_user["username"],
        profile_pic=current_user.get("profile_pic"),
        workout_type=workout["workout_type"],
        title=workout["title"],
        description=workout["description"],
        exercises=workout.get("exercises", []),
        created_at=workout["created_at"]
    ) for workout in workouts]

@api_router.delete("/workouts/{workout_id}")
async def delete_workout(workout_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.workouts.delete_one({
        "id": workout_id,
        "user_id": current_user["id"]
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Workout not found")
    
    return {"message": "Workout deleted"}

# ========================= BASIC ENDPOINTS =========================

@api_router.get("/")
async def root():
    return {"message": "GymBuddy API v1.0"}

@api_router.get("/media/{media_id}")
async def get_media(media_id: str):
    # Public on purpose: <img> tags can't send an Authorization header. The id is an unguessable
    # UUID, which is the same protection a public S3 URL gives. Photos never change, so cache hard.
    item = await db.media.find_one({"id": media_id})
    if not item:
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(
        content=bytes(item["data"]),
        media_type=item["content_type"],
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )

@api_router.get("/health")
async def health_check():
    try:
        await client.admin.command("ping")
        database_ok = True
    except Exception:
        database_ok = False
    return JSONResponse(
        status_code=200 if database_ok else 503,
        content={
            "status": "healthy" if database_ok else "degraded",
            "database": "ok" if database_ok else "unreachable",
            "timestamp": utcnow().isoformat(),
        },
    )

# ========================= STATS/PROGRESS ENDPOINTS =========================

@api_router.get("/stats")
async def get_user_stats(current_user: dict = Depends(get_current_user)):
    """Get user's gym statistics and progress"""
    today = utcnow().date()
    
    # Calculate date ranges
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    
    # All of the user's check-in dates (only the timestamp is needed, not the image)
    all_posts = await db.posts.find(
        {"user_id": current_user["id"]}, {"created_at": 1}
    ).to_list(None)

    # Total check-ins
    total_checkins = len(all_posts)
    
    # This week's check-ins
    week_checkins = len([p for p in all_posts if p["created_at"].date() >= week_start])
    
    # This month's check-ins
    month_checkins = len([p for p in all_posts if p["created_at"].date() >= month_start])
    
    # Get all friendships for streak info
    friendships = await db.friendships.find({
        "$or": [
            {"user1_id": current_user["id"], "status": "accepted"},
            {"user2_id": current_user["id"], "status": "accepted"}
        ]
    }).to_list(1000)
    
    # Current active streaks and best streak
    active_streaks = 0
    best_streak = 0
    total_streak_days = 0
    
    for f in friendships:
        streak = current_streak(f, today)
        # The best streak is remembered even after that streak has lapsed
        best_streak = max(best_streak, f.get("best_streak", 0), streak)
        total_streak_days += streak
        if streak > 0:
            active_streaks += 1
    
    # Calculate consistency (check-ins per week over last 4 weeks)
    four_weeks_ago = today - timedelta(weeks=4)
    recent_posts = [p for p in all_posts if p["created_at"].date() >= four_weeks_ago]
    
    # Group by week
    weeks_with_checkins = set()
    for p in recent_posts:
        post_date = p["created_at"].date()
        week_num = (post_date - four_weeks_ago).days // 7
        weeks_with_checkins.add(week_num)
    
    consistency_percentage = (len(weeks_with_checkins) / 4) * 100 if recent_posts else 0
    
    # Calculate check-ins per day of week (for chart)
    day_counts = {i: 0 for i in range(7)}  # 0=Monday, 6=Sunday
    for p in all_posts:
        day_counts[p["created_at"].weekday()] += 1
    
    days_of_week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    checkins_by_day = [{"day": days_of_week[i], "count": day_counts[i]} for i in range(7)]
    
    # Get weekly check-in history (last 8 weeks)
    weekly_history = []
    for i in range(7, -1, -1):
        week_date = today - timedelta(weeks=i)
        week_start_date = week_date - timedelta(days=week_date.weekday())
        week_end_date = week_start_date + timedelta(days=7)
        
        week_posts = len([p for p in all_posts 
                         if week_start_date <= p["created_at"].date() < week_end_date])
        weekly_history.append({
            "week": week_start_date.strftime("%b %d"),
            "checkins": week_posts
        })
    
    # Friends count
    friends_count = len(friendships)
    
    return {
        "total_checkins": total_checkins,
        "week_checkins": week_checkins,
        "month_checkins": month_checkins,
        "active_streaks": active_streaks,
        "best_streak": best_streak,
        "total_streak_days": total_streak_days,
        "consistency_percentage": round(consistency_percentage, 1),
        "friends_count": friends_count,
        "checkins_by_day": checkins_by_day,
        "weekly_history": weekly_history,
        "member_since": current_user["created_at"]
    }

# ========================= PUSH NOTIFICATIONS =========================

class PushTokenRegister(BaseModel):
    push_token: str

@api_router.post("/notifications/register")
async def register_push_token(data: PushTokenRegister, current_user: dict = Depends(get_current_user)):
    """Register user's push notification token"""
    # A device token belongs to one account: if someone else signed in here before, release it from them.
    await db.users.update_many(
        {"push_token": data.push_token, "id": {"$ne": current_user["id"]}},
        {"$unset": {"push_token": ""}}
    )
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"push_token": data.push_token}}
    )
    return {"message": "Push token registered"}

@api_router.delete("/notifications/unregister")
async def unregister_push_token(current_user: dict = Depends(get_current_user)):
    """Remove user's push notification token"""
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$unset": {"push_token": ""}}
    )
    return {"message": "Push token removed"}

@api_router.get("/notifications/settings")
async def get_notification_settings(current_user: dict = Depends(get_current_user)):
    """Get user's notification settings"""
    settings = await db.notification_settings.find_one({"user_id": current_user["id"]})
    if not settings:
        # Default settings
        settings = {
            "friend_posts": True,
            "streak_warnings": True,
            "friend_requests": True
        }
    return {
        "friend_posts": settings.get("friend_posts", True),
        "streak_warnings": settings.get("streak_warnings", True),
        "friend_requests": settings.get("friend_requests", True)
    }

class NotificationSettings(BaseModel):
    friend_posts: Optional[bool] = None
    streak_warnings: Optional[bool] = None
    friend_requests: Optional[bool] = None

@api_router.put("/notifications/settings")
async def update_notification_settings(settings: NotificationSettings, current_user: dict = Depends(get_current_user)):
    """Update user's notification settings"""
    update_data = {}
    if settings.friend_posts is not None:
        update_data["friend_posts"] = settings.friend_posts
    if settings.streak_warnings is not None:
        update_data["streak_warnings"] = settings.streak_warnings
    if settings.friend_requests is not None:
        update_data["friend_requests"] = settings.friend_requests
    
    if update_data:
        await db.notification_settings.update_one(
            {"user_id": current_user["id"]},
            {"$set": update_data},
            upsert=True
        )
    
    return {"message": "Settings updated"}

# Include the router in the main app
app.include_router(api_router)

# The app authenticates with a Bearer token (not cookies), so credentialed CORS isn't needed.
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

async def ensure_indexes():
    """Unique indexes stop duplicate accounts/reactions, and the rest keep the feed fast as data grows.

    Never raises: a missing index must not stop the server from starting.
    """
    try:
        await client.admin.command("ping")
    except Exception as exc:
        logger.error(f"MongoDB is not reachable at startup ({exc}). Is the database running?")
        return

    specs = [
        (db.users, [("id", 1)], {"unique": True}),
        (db.users, [("email", 1)], {"unique": True}),
        (db.users, [("username", 1)], {"unique": True}),
        (db.users, [("friend_code", 1)], {"unique": True}),
        (db.posts, [("id", 1)], {"unique": True}),
        (db.posts, [("user_id", 1), ("created_at", -1)], {}),
        (db.friendships, [("id", 1)], {"unique": True}),
        (db.friendships, [("user1_id", 1), ("user2_id", 1)], {}),
        (db.reactions, [("post_id", 1), ("user_id", 1)], {"unique": True}),
        (db.workouts, [("user_id", 1), ("created_at", -1)], {}),
        (db.notification_settings, [("user_id", 1)], {"unique": True}),
        (db.media, [("id", 1)], {"unique": True}),
    ]
    for collection, keys, options in specs:
        try:
            await collection.create_index(keys, **options)
        except Exception as exc:
            logger.warning(f"Could not create index {keys} on {collection.name}: {exc}")

async def migrate_local_uploads():
    """Move photos saved as files by earlier versions into the database, so all data lives in one place.

    Safe to run on every start: it only touches records still pointing at /uploads/..., and the original
    files are left on disk. Never raises.
    """
    try:
        root = LEGACY_UPLOAD_DIR.resolve()
        for collection, field in ((db.posts, "image"), (db.users, "profile_pic")):
            async for doc in collection.find({field: {"$regex": f"^{re.escape(LEGACY_URL_PREFIX)}"}}, {field: 1}):
                path = (LEGACY_UPLOAD_DIR / doc[field][len(LEGACY_URL_PREFIX):]).resolve()
                data = path.read_bytes() if path.is_file() and root in path.parents else b""
                detected = detect_type(data)
                if not detected:
                    logger.warning(f"Could not migrate {doc[field]}: file is missing or not a supported image")
                    continue
                url = await put_media(db, data, detected[0])
                await collection.update_one({"_id": doc["_id"]}, {"$set": {field: url}})
                logger.info(f"Moved {doc[field]} into the database as {url}")
    except Exception as exc:
        logger.warning(f"Photo migration failed (will retry on next start): {exc}")

@app.on_event("startup")
async def start_background_tasks():
    await ensure_indexes()
    await migrate_local_uploads()
    asyncio.create_task(streak_warning_scheduler())

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
