"""Bot nodes — ingest_webhook & resolve_session"""
import re
from app.bot.state import BotState
from app.database import AsyncSessionLocal
from app.models.tenancy import Restaurant, Branch, Table, TableQRToken
from app.models.customers import Customer, TableSession, SessionStatus, PreferredLanguage
from sqlalchemy import select
from datetime import datetime, timezone
import uuid


def _extract_text(msg: dict) -> tuple[str, str]:
    """Returns (text, message_type)."""
    msg_type = msg.get("type", "text")
    if msg_type == "text":
        return msg.get("text", {}).get("body", ""), "text"
    elif msg_type == "interactive":
        inter = msg.get("interactive", {})
        if inter.get("type") == "button_reply":
            return inter["button_reply"]["id"], "interactive"
        elif inter.get("type") == "list_reply":
            return inter["list_reply"]["id"], "interactive"
    return "", msg_type


async def ingest_webhook(state: BotState) -> BotState:
    """Parse raw WA payload into state fields."""
    raw = state.get("raw_message", {})
    entry = raw.get("entry", [{}])[0]
    changes = entry.get("changes", [{}])[0]
    value = changes.get("value", {})
    messages = value.get("messages", [])
    if not messages:
        state["error"] = "no_message"
        return state

    msg = messages[0]
    wa_user_id = msg.get("from", "")
    wa_message_id = msg.get("id", "")
    text, msg_type = _extract_text(msg)

    # Map phone_number_id → restaurant (if not already pre-filled from URL)
    if not state.get("restaurant_id"):
        phone_number_id = value.get("metadata", {}).get("phone_number_id", "")
        async with AsyncSessionLocal() as db:
            rest_result = await db.execute(
                select(Restaurant).where(Restaurant.whatsapp_phone_number_id == phone_number_id)
            )
            restaurant = rest_result.scalar_one_or_none()
            if restaurant:
                state["restaurant_id"] = str(restaurant.id)

    state["wa_user_id"] = wa_user_id
    state["wa_message_id"] = wa_message_id
    state["message_text"] = text
    state["message_type"] = msg_type
    return state


async def resolve_session(state: BotState) -> BotState:
    """Handle QR scan (creates session) or look up existing active session."""
    text = state.get("message_text", "")
    restaurant_id = state.get("restaurant_id")
    wa_user_id = state.get("wa_user_id")

    if not restaurant_id:
        state["error"] = "unknown_restaurant"
        return state

    # ── QR scan ──────────────────────────────────────────────────
    if "HELLODINE_START" in text.upper():
        lines = text.strip().splitlines()
        params = {}
        for line in lines[1:]:
            if "=" in line:
                k, v = line.split("=", 1)
                params[k.strip()] = v.strip()

        branch_id = params.get("branch")
        table_num = params.get("table")
        token_val = params.get("token")

        async with AsyncSessionLocal() as db:
            # Validate token
            tok_result = await db.execute(
                select(TableQRToken).where(
                    TableQRToken.token == token_val,
                    TableQRToken.is_revoked == False,
                )
            )
            token = tok_result.scalar_one_or_none()
            if not token:
                print(f"ERROR: Invalid QR Token attempted: {token_val}")
                state["error"] = "invalid_token"
                return state

            # Get table
            table_result = await db.execute(
                select(Table).where(Table.id == token.table_id, Table.is_active == True)
            )
            table = table_result.scalar_one_or_none()
            if not table:
                state["error"] = "table_not_found"
                return state

            # Get branch and verify it belongs to this restaurant
            branch_result = await db.execute(select(Branch).where(Branch.id == table.branch_id))
            branch = branch_result.scalar_one()

            if str(branch.restaurant_id) != restaurant_id:
                state["error"] = "token_restaurant_mismatch"
                return state

            # Upsert customer
            cust_result = await db.execute(
                select(Customer).where(Customer.restaurant_id == uuid.UUID(restaurant_id), Customer.wa_user_id == wa_user_id)
            )
            customer = cust_result.scalars().first()
            if not customer:
                customer = Customer(restaurant_id=uuid.UUID(restaurant_id), wa_user_id=wa_user_id)
                db.add(customer)
                await db.flush()

            # Close any existing active session for this table
            old_sess = await db.execute(
                select(TableSession).where(TableSession.table_id == table.id, TableSession.status == SessionStatus.ACTIVE)
            )
            for s in old_sess.scalars().all():
                s.status = SessionStatus.CLOSED
                s.closed_at = datetime.now(timezone.utc)

            session = TableSession(
                restaurant_id=uuid.UUID(restaurant_id),
                branch_id=branch.id,
                table_id=table.id,
                customer_id=customer.id,
            )
            db.add(session)
            await db.commit()
            await db.refresh(session)

            state["session_id"] = str(session.id)
            state["customer_id"] = str(customer.id)
            try:
                state["branch_id"] = str(branch.id)
                state["table_id"] = str(table.id)
            except Exception as e:
                print(f"ERROR in QR link mapping: {e}")
                state["error"] = "mapping_error"
                return state
            state["intent"] = "QR_SCAN"
        return state

        # ── Look up existing active session for this customer ──────────────
    async with AsyncSessionLocal() as db:
        cust_result = await db.execute(
            select(Customer).where(Customer.restaurant_id == uuid.UUID(restaurant_id), Customer.wa_user_id == wa_user_id)
        )
        customer = cust_result.scalars().first()
        if not customer:
            state["error"] = "no_session"
            return state

        sess_result = await db.execute(
            select(TableSession).where(
                TableSession.customer_id == customer.id,
                TableSession.status == SessionStatus.ACTIVE,
            ).order_by(TableSession.started_at.desc())
        )
        session = sess_result.scalars().first()
        
        # ── Inactivity Timeout (2 Hours) ──────────────────────────
        # If the customer hasn't messaged in 2 hours, expire the session
        # so they can't order remotely later.
        if session:
            now = datetime.now(timezone.utc)
            delta = now - session.last_message_at
            if delta.total_seconds() > (2 * 3600):
                session.status = SessionStatus.CLOSED
                session.closed_at = now
                await db.commit()
                session = None

        if not session:
            state["error"] = "no_session"
            return state

        # Update last_message_at
        session.last_message_at = datetime.now(timezone.utc)
        await db.commit()

        state["session_id"] = str(session.id)
        state["customer_id"] = str(customer.id)
        state["branch_id"] = str(session.branch_id)
        state["table_id"] = str(session.table_id)
        state["preferred_language"] = customer.preferred_language

    return state
