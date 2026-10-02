"""API tests, run against a live server so they exercise the real stack (FastAPI + MongoDB).

The tests create accounts and posts, so point them at a throwaway database:

    cd backend
    DB_NAME=gymbuddy_test python -m uvicorn server:app --port 8001
    GYMBUDDY_API_URL=http://127.0.0.1:8001 python -m pytest tests -q

They're skipped automatically if no server is reachable.
"""
import os
import uuid

import httpx
import pytest

BASE = os.environ.get("GYMBUDDY_API_URL", "http://127.0.0.1:8000").rstrip("/")

JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


@pytest.fixture(scope="session")
def client():
    try:
        httpx.get(f"{BASE}/api/health", timeout=3)
    except httpx.HTTPError:
        pytest.skip(f"No GymBuddy server reachable at {BASE}")
    with httpx.Client(base_url=f"{BASE}/api", timeout=30) as c:
        yield c


def make_user(client):
    tag = uuid.uuid4().hex[:8]
    response = client.post(
        "/auth/register",
        json={"email": f"{tag}@test.io", "username": f"user_{tag}", "password": "Passw0rd!"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    return {
        "id": data["user"]["id"],
        "username": data["user"]["username"],
        "code": data["user"]["friend_code"],
        "email": f"{tag}@test.io",
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


def befriend(client, a, b):
    sent = client.post("/friends/request", headers=b["headers"], json={"friend_code": a["code"]})
    assert sent.status_code == 200, sent.text
    request = client.get("/friends/requests", headers=a["headers"]).json()[0]
    accepted = client.post(f"/friends/accept/{request['id']}", headers=a["headers"])
    assert accepted.status_code == 200, accepted.text


def check_in(client, user, image=JPEG, caption="gym"):
    return client.post("/posts", headers=user["headers"], json={"image": image, "caption": caption})


def test_health_reports_database(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


def test_register_rejects_bad_input(client):
    user = make_user(client)
    good = {"email": "x@y.io", "username": "valid_name", "password": "Passw0rd!"}
    assert client.post("/auth/register", json={**good, "email": "not-an-email"}).status_code == 400
    assert client.post("/auth/register", json={**good, "username": "ab"}).status_code == 400
    assert client.post("/auth/register", json={**good, "username": "has space"}).status_code == 400
    assert client.post("/auth/register", json={**good, "password": "123"}).status_code == 400
    duplicate = client.post("/auth/register", json={**good, "email": user["email"], "username": "other_name"})
    assert duplicate.status_code == 400


def test_login_and_saved_session(client):
    user = make_user(client)
    ok = client.post("/auth/login", json={"email": f"  {user['email'].upper()} ", "password": "Passw0rd!"})
    assert ok.status_code == 200  # whitespace and case in the email must not matter
    assert client.post("/auth/login", json={"email": user["email"], "password": "wrong"}).status_code == 401
    assert client.get("/auth/me").status_code in (401, 403)
    me = client.get("/auth/me", headers=user["headers"])
    assert me.status_code == 200 and me.json()["username"] == user["username"]


def test_check_in_is_saved_and_persists(client):
    user = make_user(client)
    post = check_in(client, user, caption="leg day")
    assert post.status_code == 200, post.text

    image = post.json()["image"]
    assert image.startswith("/api/media/") or image.startswith("http")
    if image.startswith("/api/media/"):
        served = httpx.get(f"{BASE}{image}")
        assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg"
        assert "immutable" in served.headers["cache-control"]
    assert httpx.get(f"{BASE}/api/media/{uuid.uuid4()}").status_code == 404

    feed = client.get("/posts/feed", headers=user["headers"]).json()
    mine = client.get("/posts/my", headers=user["headers"]).json()
    assert [p["id"] for p in feed] == [p["id"] for p in mine] == [post.json()["id"]]
    assert feed[0]["caption"] == "leg day"
    # Timestamps must carry a UTC marker or browsers read them as local time
    assert feed[0]["created_at"].endswith("Z") or "+00:00" in feed[0]["created_at"]


def test_image_validation(client):
    user = make_user(client)
    # The real format is detected from the bytes, so a mislabelled PNG is fine
    assert check_in(client, user, image=f"data:image/jpeg;base64,{PNG}").status_code == 200
    assert check_in(client, user, image="data:image/jpeg;base64,bm90IGFuIGltYWdl").status_code == 400
    assert check_in(client, user, image="just text").status_code == 400
    assert client.put("/auth/profile", headers=user["headers"], json={"profile_pic": JPEG}).status_code == 200


def test_replacing_profile_photo_removes_the_old_one(client):
    user = make_user(client)
    first = client.put("/auth/profile", headers=user["headers"], json={"profile_pic": JPEG}).json()["profile_pic"]
    second = client.put("/auth/profile", headers=user["headers"], json={"profile_pic": f"data:image/png;base64,{PNG}"})
    second = second.json()["profile_pic"]
    assert first != second
    if second.startswith("/api/media/"):
        assert httpx.get(f"{BASE}{second}").headers["content-type"] == "image/png"
        assert httpx.get(f"{BASE}{first}").status_code == 404  # no orphaned photos piling up


def test_posts_are_private_to_friends(client):
    author, friend, stranger = make_user(client), make_user(client), make_user(client)
    befriend(client, author, friend)
    post = check_in(client, author).json()

    assert post["id"] in [p["id"] for p in client.get("/posts/feed", headers=friend["headers"]).json()]
    assert client.get("/posts/feed", headers=stranger["headers"]).json() == []
    assert client.post(f"/posts/{post['id']}/react", headers=stranger["headers"], json={"emoji": "🔥"}).status_code == 404


def test_reactions(client):
    author, friend = make_user(client), make_user(client)
    befriend(client, author, friend)
    post = check_in(client, author).json()

    assert client.post(f"/posts/{post['id']}/react", headers=friend["headers"], json={"emoji": "🔥"}).status_code == 200
    # Reacting again replaces the reaction rather than adding another
    reacted = client.post(f"/posts/{post['id']}/react", headers=friend["headers"], json={"emoji": "💪"}).json()
    assert reacted["counts"] == {"💪": 1} and reacted["my_reaction"] == "💪"
    assert client.post(f"/posts/{post['id']}/react", headers=friend["headers"], json={"emoji": "💩"}).status_code == 400
    assert client.delete(f"/posts/{post['id']}/react", headers=friend["headers"]).json()["counts"] == {}


def test_streak_counts_each_day_once(client):
    a, b = make_user(client), make_user(client)
    befriend(client, a, b)
    for user in (a, b, a, b, a):  # repeat check-ins on the same day must not inflate the streak
        assert check_in(client, user).status_code == 200

    streak = client.get("/streaks", headers=a["headers"]).json()[0]
    assert streak["streak_count"] == 1 and streak["streak_active"] is True
    assert streak["user_posted_today"] and streak["friend_posted_today"]
    stats = client.get("/stats", headers=a["headers"]).json()
    assert stats["best_streak"] == 1 and stats["total_checkins"] == 3 and stats["active_streaks"] == 1


def test_friends_flow_and_search(client):
    a, b = make_user(client), make_user(client)
    assert client.post("/friends/request", headers=a["headers"], json={"friend_code": a["code"]}).status_code == 400
    assert client.post("/friends/request", headers=a["headers"], json={"friend_code": "NOPE00"}).status_code == 404
    assert client.post("/friends/request", headers=a["headers"], json={"friend_code": b["code"]}).status_code == 200
    assert client.post("/friends/request", headers=a["headers"], json={"friend_code": b["code"]}).status_code == 400
    reverse = client.post("/friends/request", headers=b["headers"], json={"friend_code": a["code"]})
    assert reverse.status_code == 400 and "Requests tab" in reverse.json()["detail"]

    found = client.get(f"/friends/search/{b['username']}", headers=a["headers"]).json()
    assert [u["id"] for u in found] == [b["id"]] and found[0]["friendship_status"] == "pending"
    # Characters that are special in a regex used to crash the search
    for query in ("%28", "%5B", "%2A", "a%2Bb", "%5C"):
        assert client.get(f"/friends/search/{query}", headers=a["headers"]).status_code == 200

    request = client.get("/friends/requests", headers=b["headers"]).json()[0]
    assert client.post(f"/friends/accept/{request['id']}", headers=b["headers"]).status_code == 200
    assert [f["friend_id"] for f in client.get("/friends", headers=a["headers"]).json()] == [b["id"]]
    assert client.delete(f"/friends/{b['id']}", headers=a["headers"]).status_code == 200
    assert client.get("/friends", headers=a["headers"]).json() == []


def test_workouts(client):
    owner, other = make_user(client), make_user(client)
    routine = {
        "workout_type": "structured",
        "title": "Push Day",
        "description": "",
        "exercises": [{"name": "Bench", "sets": 3, "reps": "8", "weight": "60kg"}],
    }
    created = client.post("/workouts", headers=owner["headers"], json=routine)
    assert created.status_code == 200, created.text

    assert client.post("/workouts", headers=owner["headers"], json={**routine, "title": ""}).status_code == 422
    assert client.post("/workouts", headers=owner["headers"], json={**routine, "title": "   "}).status_code == 400
    assert client.post("/workouts", headers=owner["headers"], json={**routine, "workout_type": "nope"}).status_code == 422

    feed = client.get("/workouts/feed", headers=owner["headers"]).json()
    assert [w["title"] for w in feed] == ["Push Day"]
    assert client.get("/workouts/feed", headers=other["headers"]).json() == []
    assert client.delete(f"/workouts/{created.json()['id']}", headers=other["headers"]).status_code == 404
    assert client.delete(f"/workouts/{created.json()['id']}", headers=owner["headers"]).status_code == 200
    assert client.get("/workouts/my", headers=owner["headers"]).json() == []
