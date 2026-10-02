# Putting GymLock online

Three free services, set up in this order: **MongoDB Atlas** (database), **Render** (API), **Vercel** (web app).
Everything is configured in the repo already (`render.yaml`, `frontend/vercel.json`); you create the accounts and
paste in two values. Budget about 20 minutes.

## 1. Database: MongoDB Atlas

1. Sign up at [mongodb.com/atlas](https://www.mongodb.com/atlas) and create a free **M0** cluster.
2. **Database Access** -> add a user with a password (use letters and numbers only, so you don't have to URL-encode it).
3. **Network Access** -> add `0.0.0.0/0` (allow from anywhere). Render's free tier has no fixed IP, so this is required;
   the password is what protects the database.
4. **Connect -> Drivers** -> copy the connection string. It looks like
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`. Put your password in.

## 2. API: Render

1. Push this repo to GitHub (it already is), then sign up at [render.com](https://render.com).
2. **New -> Blueprint**, pick the `GymBuddy` repo. Render reads `render.yaml` and proposes a service called `gymlock-api`.
3. When asked, set **MONGO_URL** to the Atlas string from step 1. Leave **CORS_ORIGINS** blank for now.
   (`JWT_SECRET` is generated for you.)
4. Deploy. When it finishes, open `https://<your-service>.onrender.com/api/health`. It should say `"database": "ok"`.
   Note your service URL; the app needs it.

## 3. Web app: Vercel

1. Sign up at [vercel.com](https://vercel.com) and **Add New -> Project**, import the `GymBuddy` repo.
2. Set **Root Directory** to `frontend`. The build settings come from `frontend/vercel.json`.
3. Under **Environment Variables** add `EXPO_PUBLIC_BACKEND_URL` = your Render URL, e.g.
   `https://gymlock-api.onrender.com` (no trailing slash). It is baked in at build time, so if you change it, redeploy.
4. Deploy. Vercel gives you an address like `https://gymlock.vercel.app`.

## 4. Connect them

Back on Render -> your service -> **Environment**, set **CORS_ORIGINS** to your Vercel address
(e.g. `https://gymlock.vercel.app`, no trailing slash) and save. Render redeploys. Open your Vercel address, register an
account, and post a check-in.

## Good to know

- **Cold starts.** On the free plan the API sleeps after ~15 minutes without traffic, and the first request afterwards
  takes up to a minute. The app pings the server as soon as it opens to hide most of that.
- **Notifications.** Streak-warning notifications are sent by a timer inside the API, so they don't go out while it's asleep.
  Push notifications also need a phone build (`eas init`); they don't work on the web version.
- **Photos live in the database.** Atlas's free 512 MB holds thousands of the shrunken photos. Photos are served from
  `/api/media/<id>` without a login (like a public image link), but each address is an unguessable random id.
- **Your local data stays local.** The deployed app starts with an empty database. To copy your local data over,
  use `mongodump` / `mongorestore`.
- **Secrets.** Never commit a `.env` file or paste `MONGO_URL` / `JWT_SECRET` anywhere public. Rotating `JWT_SECRET`
  signs everybody out, which is the right move if it ever leaks.
- **Not built yet:** rate limiting on login, so use a strong password on your Atlas user and your own account.
