"""Stores post and profile images.

Images arrive from the client as base64 data URIs. They are validated, then saved:

- With AWS_S3_BUCKET set, in S3-compatible storage; the public URL is returned.
- Otherwise, in the database's `media` collection, served by the API at /api/media/<id>.
  That needs no extra service and keeps all of your data in one place (the database).

Clients shrink photos before uploading, so a photo is typically a few hundred KB.
"""
import base64
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import boto3
from bson import Binary
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 15 * 1024 * 1024  # stays under MongoDB's 16MB document limit

DATA_URI_RE = re.compile(r"^data:image/[\w+.-]+;base64,(.+)$", re.DOTALL)

# Detected from the bytes, not the declared type: the client can't be trusted to label them correctly.
IMAGE_SIGNATURES = [
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"GIF8", "image/gif", "gif"),
]

MEDIA_URL_PREFIX = "/api/media"

# Earlier versions saved photos as files here and stored a "/uploads/..." path instead.
LEGACY_UPLOAD_DIR = Path(__file__).parent / "uploads"
LEGACY_URL_PREFIX = "/uploads/"

_bucket = os.environ.get("AWS_S3_BUCKET")
_region = os.environ.get("AWS_REGION", "us-east-1")
_endpoint_url = os.environ.get("AWS_S3_ENDPOINT_URL")  # set for R2 / Spaces / MinIO, leave unset for AWS S3
_public_url_base = os.environ.get("AWS_S3_PUBLIC_URL_BASE")  # e.g. a CDN domain in front of the bucket

_s3_client = None


def _get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=_region, endpoint_url=_endpoint_url)
    return _s3_client


def detect_type(raw: bytes):
    """Returns (mime, extension) from the file's own bytes, or None if it isn't a supported image."""
    for signature, mime, ext in IMAGE_SIGNATURES:
        if raw.startswith(signature):
            return mime, ext
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


def decode_image(data_uri: str):
    """Validates a base64 image data URI. Returns (bytes, mime, extension) or raises a 4xx HTTPException."""
    match = DATA_URI_RE.match(data_uri.strip())
    if not match:
        raise HTTPException(status_code=400, detail="Image must be a base64 data URI")

    try:
        raw = base64.b64decode(match.group(1), validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 15MB)")

    detected = detect_type(raw)
    if not detected:
        raise HTTPException(status_code=400, detail="Unsupported image format - use a JPEG, PNG, WebP or GIF")
    return (raw, *detected)


async def put_media(db, raw: bytes, mime: str) -> str:
    """Stores image bytes in the database and returns the URL path they're served from."""
    media_id = str(uuid.uuid4())
    await db.media.insert_one({
        "id": media_id,
        "content_type": mime,
        "data": Binary(raw),
        "created_at": datetime.now(timezone.utc),
    })
    return f"{MEDIA_URL_PREFIX}/{media_id}"


def _put_s3_object(raw: bytes, key: str, mime: str) -> str:
    try:
        _get_s3_client().put_object(Bucket=_bucket, Key=key, Body=raw, ContentType=mime)
    except Exception as exc:
        logger.error(f"S3 upload failed for key {key}: {exc}")
        raise HTTPException(status_code=502, detail="Failed to upload image")

    if _public_url_base:
        return f"{_public_url_base.rstrip('/')}/{key}"
    if _endpoint_url:
        return f"{_endpoint_url.rstrip('/')}/{_bucket}/{key}"
    return f"https://{_bucket}.s3.{_region}.amazonaws.com/{key}"


async def save_image(db, data_uri: str, prefix: str) -> str:
    """Validates and stores an image; returns the URL (or /api/media path) to save on the post or profile."""
    raw, mime, ext = decode_image(data_uri)
    if _bucket:
        return await run_in_threadpool(_put_s3_object, raw, f"{prefix}/{uuid.uuid4()}.{ext}", mime)
    return await put_media(db, raw, mime)


async def delete_media(db, url) -> None:
    """Removes a stored image once nothing needs it any more. Ignores URLs that aren't ours (e.g. S3)."""
    if isinstance(url, str) and url.startswith(f"{MEDIA_URL_PREFIX}/"):
        await db.media.delete_one({"id": url[len(MEDIA_URL_PREFIX) + 1:]})
