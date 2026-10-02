"""Stores post and profile images.

Images arrive from the client as base64 data URIs. Storing those inline in MongoDB
documents doesn't scale, so the decoded bytes are written to a file instead:

- With AWS_S3_BUCKET set, they go to S3-compatible storage and the public URL is returned.
- Without it, they are saved under UPLOAD_DIR and a relative "/uploads/..." path is
  returned, which the API serves itself. Posting works with zero setup, and the app
  resolves the relative path against whichever host it used to reach the API.
"""
import base64
import logging
import os
import re
import uuid
from pathlib import Path

import boto3
from fastapi import HTTPException

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 15 * 1024 * 1024

DATA_URI_RE = re.compile(r"^data:image/[\w+.-]+;base64,(.+)$", re.DOTALL)

# Detected from the bytes, not the declared type: the client can't be trusted to label them correctly.
IMAGE_SIGNATURES = [
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"GIF8", "image/gif", "gif"),
]

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR") or Path(__file__).parent / "uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
LOCAL_URL_PREFIX = "/uploads"

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


def _detect_type(raw: bytes):
    for signature, mime, ext in IMAGE_SIGNATURES:
        if raw.startswith(signature):
            return mime, ext
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


def upload_image(data_uri: str, prefix: str) -> str:
    """Decode a base64 image data URI, store it, and return the URL (or relative /uploads path) to save."""
    match = DATA_URI_RE.match(data_uri.strip())
    if not match:
        raise HTTPException(status_code=400, detail="Image must be a base64 data URI")

    try:
        raw = base64.b64decode(match.group(1), validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 15MB)")

    detected = _detect_type(raw)
    if not detected:
        raise HTTPException(status_code=400, detail="Unsupported image format - use a JPEG, PNG, WebP or GIF")
    mime_type, ext = detected

    key = f"{prefix}/{uuid.uuid4()}.{ext}"

    if not _bucket:
        destination = UPLOAD_DIR / key
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
        except OSError as exc:
            logger.error(f"Saving upload {key} failed: {exc}")
            raise HTTPException(status_code=500, detail="Could not save the image on the server")
        return f"{LOCAL_URL_PREFIX}/{key}"

    try:
        _get_s3_client().put_object(Bucket=_bucket, Key=key, Body=raw, ContentType=mime_type)
    except Exception as exc:
        logger.error(f"S3 upload failed for key {key}: {exc}")
        raise HTTPException(status_code=502, detail="Failed to upload image")

    if _public_url_base:
        return f"{_public_url_base.rstrip('/')}/{key}"
    if _endpoint_url:
        return f"{_endpoint_url.rstrip('/')}/{_bucket}/{key}"
    return f"https://{_bucket}.s3.{_region}.amazonaws.com/{key}"
