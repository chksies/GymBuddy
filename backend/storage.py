"""Uploads post and profile images to S3-compatible object storage.

Images arrive from the client as base64 data URIs (see frontend/app/(tabs)/post.tsx
and profile.tsx). Storing those directly in MongoDB documents doesn't scale - each
photo bloats its document by megabytes, slows every query that touches it, and
blows past MongoDB's 16MB document size limit. This uploads the decoded bytes to
an S3-compatible bucket and returns a plain URL for the app to store instead.
"""
import base64
import logging
import os
import re
import uuid

import boto3
from fastapi import HTTPException

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8MB
ALLOWED_MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

DATA_URI_RE = re.compile(r"^data:(image/[\w+.-]+);base64,(.+)$", re.DOTALL)

_bucket = os.environ.get("AWS_S3_BUCKET")
_region = os.environ.get("AWS_REGION", "us-east-1")
_endpoint_url = os.environ.get("AWS_S3_ENDPOINT_URL")  # set for R2 / Spaces / MinIO, leave unset for AWS S3
_public_url_base = os.environ.get("AWS_S3_PUBLIC_URL_BASE")  # e.g. a CDN domain in front of the bucket

_s3_client = None


def _get_client():
    global _s3_client
    if _s3_client is None:
        if not _bucket:
            raise HTTPException(
                status_code=500,
                detail="Image storage is not configured (AWS_S3_BUCKET missing) - see backend/.env.example",
            )
        _s3_client = boto3.client("s3", region_name=_region, endpoint_url=_endpoint_url)
    return _s3_client


def upload_image(data_uri: str, prefix: str) -> str:
    """Decode a base64 image data URI, upload it, and return its public URL."""
    match = DATA_URI_RE.match(data_uri.strip())
    if not match:
        raise HTTPException(status_code=400, detail="Image must be a base64 data URI")

    mime_type, b64_data = match.group(1), match.group(2)
    ext = ALLOWED_MIME_TO_EXT.get(mime_type)
    if not ext:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {mime_type}")

    try:
        raw = base64.b64decode(b64_data, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 8MB)")

    key = f"{prefix}/{uuid.uuid4()}.{ext}"
    client = _get_client()

    try:
        client.put_object(Bucket=_bucket, Key=key, Body=raw, ContentType=mime_type)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"S3 upload failed for key {key}: {exc}")
        raise HTTPException(status_code=502, detail="Failed to upload image")

    if _public_url_base:
        return f"{_public_url_base.rstrip('/')}/{key}"
    if _endpoint_url:
        return f"{_endpoint_url.rstrip('/')}/{_bucket}/{key}"
    return f"https://{_bucket}.s3.{_region}.amazonaws.com/{key}"
