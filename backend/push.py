"""Sends push notifications through Expo's push API."""
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_BATCH_SIZE = 100  # Expo's documented max messages per request


def build_message(token: str, title: str, body: str, data: Optional[dict] = None) -> dict:
    return {
        "to": token,
        "sound": "default",
        "title": title,
        "body": body,
        "data": data or {},
    }


async def send_push_notifications(messages: list[dict]) -> None:
    """Send a batch of Expo push messages. Never raises - a failed push shouldn't fail the request that triggered it."""
    valid = [m for m in messages if m.get("to", "").startswith("ExponentPushToken[")]
    if not valid:
        return

    async with httpx.AsyncClient(timeout=10.0) as client:
        for i in range(0, len(valid), EXPO_BATCH_SIZE):
            batch = valid[i:i + EXPO_BATCH_SIZE]
            try:
                response = await client.post(
                    EXPO_PUSH_URL,
                    json=batch,
                    headers={
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip, deflate",
                        "Content-Type": "application/json",
                    },
                )
                response.raise_for_status()
            except Exception as exc:
                logger.warning(f"Expo push send failed for batch of {len(batch)}: {exc}")
