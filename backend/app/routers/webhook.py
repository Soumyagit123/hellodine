"""WhatsApp Webhook router — /api/webhook"""
from fastapi import APIRouter, Request, Response, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.bot.graph import compiled_graph
from app.database import AsyncSessionLocal
from app.models.logs import WhatsAppMessageLog, MessageDirection
from app.bot.wa_sender import send_text, send_interactive_buttons, send_interactive_list
from app.models.tenancy import Restaurant
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
import hmac
import hashlib
import uuid
import logging
import json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhook", tags=["webhook"])


def verify_signature(payload: bytes, signature: str, app_secret: str) -> bool:
    """Verify Meta's X-Hub-Signature-256."""
    if not signature or not signature.startswith("sha256="):
        return False
    
    expected = hmac.new(
        app_secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(f"sha256={expected}", signature)


@router.get("/{restaurant_id}")
async def verify_webhook(restaurant_id: uuid.UUID, request: Request):
    """Meta webhook verification handshake per restaurant."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Restaurant).where(Restaurant.id == restaurant_id))
        restaurant = result.scalar_one_or_none()
        if not restaurant:
            raise HTTPException(404, "Restaurant not found")

    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")
    
    # Use restaurant-specific verify token, fallback to global settings
    verify_token = restaurant.whatsapp_verify_token or settings.WA_WEBHOOK_VERIFY_TOKEN
    if mode == "subscribe" and token == verify_token:
        return Response(content=challenge, media_type="text/plain")
    
    raise HTTPException(403, "Verification failed")


@router.post("/{restaurant_id}")
async def receive_webhook(restaurant_id: uuid.UUID, request: Request):
    """Inbound WhatsApp messages per restaurant → LangGraph bot."""
    body_raw = await request.body()
    try:
        payload = await request.json()
        print(f"WEBHOOK RECEIVED: {json.dumps(payload, indent=2)}")
    except Exception as e:
        print(f"WEBHOOK JSON ERROR: {str(e)}")
        return {"status": "error", "reason": "invalid_json"}
        
    signature = request.headers.get("X-Hub-Signature-256")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Restaurant).where(Restaurant.id == restaurant_id))
        restaurant = result.scalar_one_or_none()
        if not restaurant:
            raise HTTPException(404, "Restaurant not found")
        
        # Use DB credentials, fall back to Render env vars if not set in DB
        access_token = restaurant.whatsapp_access_token or settings.WA_ACCESS_TOKEN
        app_secret = restaurant.whatsapp_app_secret or settings.WA_APP_SECRET

        if not access_token:
            logger.error(f"Missing WhatsApp Access Token for restaurant {restaurant_id}")
            return {"status": "ignored", "reason": "missing_credentials"}

        # Verify signature if secret is provided
        if app_secret:
            if not verify_signature(body_raw, signature, app_secret):
                raise HTTPException(401, "Invalid signature")

        # Run LangGraph bot
        try:
            val = payload.get("entry", [{}])[0].get("changes", [{}])[0].get("value", {})
            if not val.get("messages"):
                logger.info("Skip webhook: no messages (likely a status update)")
                return {"status": "ignored", "reason": "no_messages"}

            initial_state = {
                "raw_message": payload,
                "restaurant_id": str(restaurant_id)
            }
            initial_state["access_token"] = access_token
            initial_state["phone_number_id"] = restaurant.whatsapp_phone_number_id
            
            logger.info(f"Invoking graph for restaurant {restaurant.name} ({restaurant_id})")
            result = await compiled_graph.ainvoke(initial_state)
            logger.info(f"Graph execution finished. Intent: {result.get('intent')}, Error: {result.get('error')}")

            # Send the response back to WhatsApp
            final = result.get("final_response")
            to = result.get("wa_user_id") # MUST be the phone number (WA_ID)
            # Use DB credentials, fall back to Render env vars if not set in DB
            p_id = restaurant.whatsapp_phone_number_id or settings.WA_PHONE_NUMBER_ID
            token = restaurant.whatsapp_access_token or settings.WA_ACCESS_TOKEN
            
            print(f"WEBHOOK FLOW END: intent={result.get('intent')}, to={to}, has_response={bool(final)}")

            if final and to and p_id and token:
                msg_type = final.get("type", "text")
                print(f"SENDING REPLY: type={msg_type}, to={to}, p_id={p_id}")
                try:
                    if msg_type == "text":
                        resp = await send_text(to, final["body"], p_id, token)
                    elif msg_type == "buttons":
                        resp = await send_interactive_buttons(to, final["body"], final["buttons"], p_id, token)
                    elif msg_type == "list":
                        resp = await send_interactive_list(to, final["body"], final.get("button_label", "View"), final["sections"], p_id, token)
                    
                    print(f"META RESPONSE: {resp}")
                    logger.info(f"WhatsApp API response: {resp}")
                except Exception as e:
                    print(f"SEND ERROR: {str(e)}")
                    logger.exception(f"Failed to send WhatsApp message: {str(e)}")
            elif final and to:
                print(f"MISSING CREDENTIALS: p_id={p_id}, token={'set' if token else 'missing'}")
                logger.error(f"Cannot send reply: Missing credentials (p_id={p_id}, token={'set' if token else 'missing'})")
            else:
                print(f"NO RESPONSE PREPARED for {to}")
                logger.warning(f"No response prepared for message from {to}")
                
        except Exception as e:
            logger.exception(f"Error in LangGraph execution: {str(e)}")
            # Optional: send a generic error message to the user?
            # await send_text(to, "Sorry, I'm having trouble processing your request. Please try again later.", p_id, token)

    return {"status": "ok"}
