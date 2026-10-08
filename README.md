# GymBuddy

A social fitness accountability app, inspired by Locket and Snapchat: friends share gym check-in photos and keep each other honest with streaks, reactions, and shared workouts.

**Stack:** FastAPI + MongoDB backend, Expo (React Native) frontend running on iOS, Android, and web from one codebase.

---

## Features

| Area | What's implemented |
|---|---|
| **Authentication** | Email/password (bcrypt), JWT access tokens (7-day expiry), auto-generated 6-character friend codes |
| **Check-ins** | Camera or gallery photo, optional caption; photos are stored in the database (or in S3-compatible storage if configured); delete your own with the trash icon on the feed |
| **Friends** | Add by friend code or username search, QR code display/scan (mobile), request/accept/decline, remove |
| **Streaks** | Starts when both friends post the same day; stays alive as long as both post within 3 days; shows days remaining |
| **Reactions** | Tap to react to a check-in with 🔥 💪 👏 😮; counts and your own reaction shown per post |
| **Workouts** | Share a quick tip or a structured routine (exercise / sets / reps / weight / notes); feed of friends' workouts |
| **Stats** | Total check-ins, best streak, weekly/monthly counts, 4-week consistency %, check-ins by day of week, 8-week history |
| **Push notifications** | Friend posts, friend requests (sent + accepted), and a background sweep that warns both sides when a streak has one day left |
| **Profile** | Profile photo, friend code, notification toggles, logout |

## Project structure

```
backend/
  server.py            FastAPI app: auth, posts, friends, streaks, workouts, stats, notification settings
  push.py              Sends notifications through Expo's push API
  storage.py           Saves check-in/profile images (in the database by default, S3 if configured)
  requirements.txt     What the API needs to run (requirements-dev.txt adds test/lint tools)
  .env.example         Required environment variables

frontend/
  app/
    (auth)/            Login, register
    (tabs)/            Feed, check-in, streaks, stats, friends, workouts, profile
  src/
    contexts/          Auth context (token storage, current user)
    services/api.ts    Axios client + per-feature API calls
```

## Running it locally

### Backend

Requires Python 3.9+ and a MongoDB instance (installed locally or run in Docker).

```bash
cd backend
cp .env.example .env     # set MONGO_URL and JWT_SECRET
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

**Where your data lives.** Everything is stored in MongoDB: accounts, check-ins, friends, streaks, workouts and the photos themselves (served by the API at `/api/media/<id>`). It survives restarts of the app and the API as long as MongoDB keeps running with the same data folder, and backing up or moving the database moves all of it. (Earlier versions saved photos as files in `backend/uploads/`; any found there are moved into the database automatically on startup.)

**Optional: S3 for photos.** To store photos in S3-compatible storage instead (AWS S3, Cloudflare R2, DigitalOcean Spaces, or MinIO all work via `boto3`), fill in the `AWS_S3_*` variables from `.env.example`. The bucket needs a policy allowing public `GetObject`, since photos are loaded by URL.

**Tests.** The API tests run against a live server and create accounts and posts, so use a throwaway database (`pip install -r requirements-dev.txt` first):

```bash
cd backend
DB_NAME=gymbuddy_test uvicorn server:app --port 8001
# in a second terminal, from the repo root:
GYMBUDDY_API_URL=http://127.0.0.1:8001 python -m pytest tests -q
```

### Frontend

Requires Node 18+.

```bash
cd frontend
echo "EXPO_PUBLIC_BACKEND_URL=http://localhost:8000" > .env
npm install
npm run web      # or: npm run ios / npm run android
```

For push notifications to work on a real device, the app needs to be linked to an EAS project:

```bash
cd frontend
eas init
```

(requires a free Expo account). Camera, friend QR scanning, and push notifications only work on iOS/Android — the web build runs everything else (feed, reactions, friends, streaks, stats, profile) against the same backend.

## API overview

All routes are under `/api`.

| Method & path | Notes |
|---|---|
| `POST /auth/register` · `POST /auth/login` | Creates/authenticates a user; returns a JWT |
| `GET /auth/me` · `PUT /auth/profile` | Current user; update username/profile photo |
| `POST /posts` · `GET /posts/feed` · `GET /posts/my` | Create a check-in; friends' feed; your own posts |
| `DELETE /posts/{id}` | Delete your own check-in, with its photo and reactions (404 for anyone else's) |
| `POST /posts/{id}/react` · `DELETE /posts/{id}/react` | Set or remove your reaction on a post |
| `POST /friends/request` · `GET /friends/search/{query}` | Send a request by friend code; search by username/code |
| `GET /friends` · `GET /friends/requests` | List friends; list incoming pending requests |
| `POST /friends/accept/{id}` · `POST /friends/decline/{id}` · `DELETE /friends/{id}` | Respond to or remove a friendship |
| `GET /streaks` | All streaks with friends, including days remaining and who's posted today |
| `POST /workouts` · `GET /workouts/feed` · `GET /workouts/my` · `DELETE /workouts/{id}` | Share, browse, and remove workouts |
| `GET /stats` | Check-in counts, streaks, consistency %, charts data |
| `POST /notifications/register` · `DELETE /notifications/unregister` | Register/remove an Expo push token |
| `GET /notifications/settings` · `PUT /notifications/settings` | Per-category notification toggles |
| `GET /media/{id}` | A stored photo (public link, unguessable id) |
| `GET /health` | Health check, including whether the database is reachable |

## Known gaps

- No refresh tokens — a single 7-day JWT with no revocation path
- No rate limiting (login attempts aren't throttled)
- "Today" for streaks and stats is a UTC day, so an evening check-in in a timezone behind UTC can count toward the next day
- Web builds can't use the camera for QR scanning or receive push notifications (mobile only)
