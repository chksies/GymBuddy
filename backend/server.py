from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timedelta
import bcrypt
import jwt
import random
import string

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'gymbuddy_db')]

# JWT Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'gymbuddy_secret_key_2025')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

# Security
security = HTTPBearer()

# Create the main app
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

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
    caption: Optional[str] = ""

class PostResponse(BaseModel):
    id: str
    user_id: str
    username: str
    profile_pic: Optional[str] = None
    image: str
    caption: str
    created_at: datetime

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
    name: str
    sets: Optional[int] = None
    reps: Optional[str] = None
    weight: Optional[str] = None
    notes: Optional[str] = None

class WorkoutCreate(BaseModel):
    workout_type: str  # 'text' or 'structured'
    title: str
    description: Optional[str] = ""
    exercises: Optional[List[WorkoutExercise]] = []

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
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
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

# ========================= AUTH ENDPOINTS =========================

@api_router.post("/auth/register")
async def register(user_data: UserCreate):
    # Check if email exists
    existing_email = await db.users.find_one({"email": user_data.email.lower()})
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Check if username exists
    existing_username = await db.users.find_one({"username": user_data.username.lower()})
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already taken")
    
    # Generate unique friend code
    friend_code = generate_friend_code()
    while await db.users.find_one({"friend_code": friend_code}):
        friend_code = generate_friend_code()
    
    user = {
        "id": str(uuid.uuid4()),
        "email": user_data.email.lower(),
        "password_hash": hash_password(user_data.password),
        "username": user_data.username.lower(),
        "friend_code": friend_code,
        "profile_pic": None,
        "created_at": datetime.utcnow()
    }
    
    await db.users.insert_one(user)
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
    user = await db.users.find_one({"email": credentials.email.lower()})
    if not user or not verify_password(credentials.password, user["password_hash"]):
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
        # Check if username is taken by another user
        existing = await db.users.find_one({
            "username": profile.username.lower(),
            "id": {"$ne": current_user["id"]}
        })
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
        update_data["username"] = profile.username.lower()
    
    if profile.profile_pic is not None:
        update_data["profile_pic"] = profile.profile_pic
    
    if update_data:
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": update_data}
        )
    
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
    post = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "image": post_data.image,
        "caption": post_data.caption or "",
        "created_at": datetime.utcnow()
    }
    
    await db.posts.insert_one(post)
    
    # Update streaks with all friends
    await update_streaks_for_user(current_user["id"])
    
    return PostResponse(
        id=post["id"],
        user_id=post["user_id"],
        username=current_user["username"],
        profile_pic=current_user.get("profile_pic"),
        image=post["image"],
        caption=post["caption"],
        created_at=post["created_at"]
    )

@api_router.get("/posts/feed")
async def get_feed(current_user: dict = Depends(get_current_user)):
    # Get all accepted friendships
    friendships = await db.friendships.find({
        "$or": [
            {"user1_id": current_user["id"], "status": "accepted"},
            {"user2_id": current_user["id"], "status": "accepted"}
        ]
    }).to_list(1000)
    
    # Get friend IDs
    friend_ids = []
    for f in friendships:
        if f["user1_id"] == current_user["id"]:
            friend_ids.append(f["user2_id"])
        else:
            friend_ids.append(f["user1_id"])
    
    # Include own posts
    friend_ids.append(current_user["id"])
    
    # Get posts from friends and self
    posts = await db.posts.find({
        "user_id": {"$in": friend_ids}
    }).sort("created_at", -1).to_list(100)
    
    # Get user details for posts
    result = []
    for post in posts:
        user = await db.users.find_one({"id": post["user_id"]})
        if user:
            result.append(PostResponse(
                id=post["id"],
                user_id=post["user_id"],
                username=user["username"],
                profile_pic=user.get("profile_pic"),
                image=post["image"],
                caption=post["caption"],
                created_at=post["created_at"]
            ))
    
    return result

@api_router.get("/posts/my")
async def get_my_posts(current_user: dict = Depends(get_current_user)):
    posts = await db.posts.find({
        "user_id": current_user["id"]
    }).sort("created_at", -1).to_list(100)
    
    return [PostResponse(
        id=post["id"],
        user_id=post["user_id"],
        username=current_user["username"],
        profile_pic=current_user.get("profile_pic"),
        image=post["image"],
        caption=post["caption"],
        created_at=post["created_at"]
    ) for post in posts]

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
            raise HTTPException(status_code=400, detail="Friend request already pending")
    
    friendship = {
        "id": str(uuid.uuid4()),
        "user1_id": current_user["id"],  # Requester
        "user2_id": friend["id"],  # Recipient
        "status": "pending",
        "streak_count": 0,
        "last_mutual_post": None,
        "created_at": datetime.utcnow()
    }
    
    await db.friendships.insert_one(friendship)
    
    return {"message": "Friend request sent", "friendship_id": friendship["id"]}

@api_router.get("/friends/search/{query}")
async def search_users(query: str, current_user: dict = Depends(get_current_user)):
    # Search by username or friend code
    users = await db.users.find({
        "$or": [
            {"username": {"$regex": query.lower(), "$options": "i"}},
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
                streak_count=f["streak_count"],
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

async def update_streaks_for_user(user_id: str):
    """Update streaks when a user posts"""
    today = datetime.utcnow().date()
    
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
            current_streak = friendship.get("streak_count", 0)
            
            if last_mutual:
                last_mutual_date = last_mutual.date() if isinstance(last_mutual, datetime) else last_mutual
                days_diff = (today - last_mutual_date).days
                
                if days_diff <= 3:
                    # Continue streak
                    new_streak = current_streak + 1
                else:
                    # Streak broken, start new
                    new_streak = 1
            else:
                # First mutual post
                new_streak = 1
            
            await db.friendships.update_one(
                {"id": friendship["id"]},
                {"$set": {
                    "streak_count": new_streak,
                    "last_mutual_post": datetime.utcnow()
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
    today = datetime.utcnow().date()
    
    for f in friendships:
        friend_id = f["user2_id"] if f["user1_id"] == current_user["id"] else f["user1_id"]
        friend = await db.users.find_one({"id": friend_id})
        
        if friend:
            last_mutual = f.get("last_mutual_post")
            streak_active = False
            days_remaining = 0
            
            if last_mutual:
                last_mutual_date = last_mutual.date() if isinstance(last_mutual, datetime) else last_mutual
                days_diff = (today - last_mutual_date).days
                if days_diff <= 3:
                    streak_active = True
                    days_remaining = 3 - days_diff
            
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
                "streak_count": f["streak_count"],
                "streak_active": streak_active,
                "days_remaining": days_remaining,
                "user_posted_today": user_posted_today,
                "friend_posted_today": friend_posted_today,
                "last_mutual_post": last_mutual
            })
    
    return result

# ========================= WORKOUTS ENDPOINTS =========================

@api_router.post("/workouts")
async def create_workout(workout_data: WorkoutCreate, current_user: dict = Depends(get_current_user)):
    workout = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "workout_type": workout_data.workout_type,
        "title": workout_data.title,
        "description": workout_data.description or "",
        "exercises": [e.dict() for e in (workout_data.exercises or [])],
        "created_at": datetime.utcnow()
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
    # Get all accepted friendships
    friendships = await db.friendships.find({
        "$or": [
            {"user1_id": current_user["id"], "status": "accepted"},
            {"user2_id": current_user["id"], "status": "accepted"}
        ]
    }).to_list(1000)
    
    # Get friend IDs
    friend_ids = []
    for f in friendships:
        if f["user1_id"] == current_user["id"]:
            friend_ids.append(f["user2_id"])
        else:
            friend_ids.append(f["user1_id"])
    
    # Include own workouts
    friend_ids.append(current_user["id"])
    
    # Get workouts from friends and self
    workouts = await db.workouts.find({
        "user_id": {"$in": friend_ids}
    }).sort("created_at", -1).to_list(100)
    
    result = []
    for workout in workouts:
        user = await db.users.find_one({"id": workout["user_id"]})
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

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow()}

# ========================= STATS/PROGRESS ENDPOINTS =========================

@api_router.get("/stats")
async def get_user_stats(current_user: dict = Depends(get_current_user)):
    """Get user's gym statistics and progress"""
    today = datetime.utcnow().date()
    
    # Calculate date ranges
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    
    # Get all user's posts
    all_posts = await db.posts.find({"user_id": current_user["id"]}).to_list(1000)
    
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
        streak = f.get("streak_count", 0)
        if streak > best_streak:
            best_streak = streak
        total_streak_days += streak
        
        # Check if streak is active
        last_mutual = f.get("last_mutual_post")
        if last_mutual:
            last_mutual_date = last_mutual.date() if isinstance(last_mutual, datetime) else last_mutual
            if (today - last_mutual_date).days <= 3 and streak > 0:
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

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
