"""Bot node — entertainment (Jokes, Trivia, Kids Cartoons, Birthday Celebrations)."""
import asyncio
import uuid
import random
from typing import Any
import google.generativeai as genai  # type: ignore
from sqlalchemy import select
from app.bot.state import BotState
from app.database import AsyncSessionLocal
from app.models.tenancy import Restaurant, Table
from app.services.ws_manager import manager
from app.config import settings

_genai: Any = genai
_genai.configure(api_key=settings.GEMINI_API_KEY)
model: Any = _genai.GenerativeModel(
    "gemini-3.5-flash-lite",
    generation_config={"temperature": 0.6, "max_output_tokens": 150},
)
fallback_model: Any = _genai.GenerativeModel(
    "gemini-2.5-flash-lite",
    generation_config={"temperature": 0.6, "max_output_tokens": 150},
)

FALLBACK_JOKES = [
    "Why did the restaurant hire a frog? Because he was great at catching flies and jumping to conclusions! 🐸😄",
    "What do you call cheese that isn't yours? Nacho cheese! 🧀😂",
    "Why did the tomato turn red? Because it saw the salad dressing! 🍅🥗",
    "Why don't eggs tell jokes at the breakfast table? They'd crack each other up! 🥚🤣",
    "What did the paneer say to the naan? 'You butter believe we make a great pair!' 🫓🧀",
]


async def entertainment_node(state: BotState) -> BotState:
    """Handle ENTERTAIN_JOKE, ENTERTAIN_CARTOON, and BIRTHDAY_WISH intents."""
    intent = state.get("intent")
    entities = state.get("entities", {})
    restaurant_id = state.get("restaurant_id")
    branch_id = state.get("branch_id")
    table_id = state.get("table_id")

    restaurant_name = "HelloDine Restaurant"
    table_num = ""

    async with AsyncSessionLocal() as db:
        if restaurant_id:
            r_res = await db.execute(select(Restaurant).where(Restaurant.id == uuid.UUID(restaurant_id)))
            rest = r_res.scalar_one_or_none()
            if rest:
                restaurant_name = rest.name
        if table_id:
            t_res = await db.execute(select(Table).where(Table.id == uuid.UUID(table_id)))
            tbl = t_res.scalar_one_or_none()
            if tbl:
                table_num = str(tbl.table_number)

    # 1. JOKE / TRIVIA
    if intent == "ENTERTAIN_JOKE":
        joke_text = random.choice(FALLBACK_JOKES)
        try:
            prompt = (
                f"You are a cheerful AI host at {restaurant_name}. "
                "Tell one short, clean, hilarious food or restaurant joke (or fun food trivia) suitable for families and kids waiting for their meal. "
                "Keep it under 3 sentences and include emojis."
            )
            try:
                resp = await asyncio.to_thread(model.generate_content, prompt)
            except Exception:
                resp = await asyncio.to_thread(fallback_model.generate_content, prompt)
            if resp and resp.text:
                joke_text = resp.text.strip()
        except Exception as e:
            print(f"Joke generation fallback: {e}")

        state["ui_action"] = {
            "action": "SHOW_JOKE",
            "joke": joke_text,
        }
        state["final_response"] = {
            "type": "buttons",
            "body": f"😂 *Here's one while your food prepares:*\n\n{joke_text}",
            "buttons": [
                {"id": "tell_joke", "title": "😂 Another Joke"},
                {"id": "show_cartoons", "title": "🎬 Kids Cartoons"},
                {"id": "show_menu", "title": "📋 View Menu"},
            ],
        }
        return state

    # 2. KIDS CARTOON VIDEOS
    if intent == "ENTERTAIN_CARTOON":
        state["ui_action"] = {
            "action": "SHOW_CARTOONS",
        }
        state["final_response"] = {
            "type": "buttons",
            "body": "🎬 *Opening Kids Cartoon Theatre!* 🧸🍿\n\nWe've loaded fun, kid-friendly cartoons on your screen while your delicious food is being prepared!",
            "buttons": [
                {"id": "tell_joke", "title": "😂 Tell a Joke"},
                {"id": "show_menu", "title": "📋 Add More Food"},
            ],
        }
        return state

    # 3. BIRTHDAY CELEBRATION
    if intent == "BIRTHDAY_WISH":
        bday_name = (entities.get("birthday_name") or entities.get("name") or "Special Guest").strip().title()
        wish_text = (
            f"🎂🎉 *HAPPY BIRTHDAY, {bday_name.upper()}!* 🎉🎂\n\n"
            f"Wishing you a day filled with laughter, magic, and delicious food from all of us at *{restaurant_name}*! "
            f"May this year bring you endless happiness and sweet memories! 🥳✨🎈"
        )
        try:
            prompt = (
                f"Write a warm, magical, celebratory 3-sentence birthday wish for '{bday_name}' who is dining at '{restaurant_name}' right now. "
                f"Mention '{bday_name}' by name, make it joyful and memorable, and include festive emojis."
            )
            try:
                resp = await asyncio.to_thread(model.generate_content, prompt)
            except Exception:
                resp = await asyncio.to_thread(fallback_model.generate_content, prompt)
            if resp and resp.text:
                wish_text = f"🎂🎉 *Happy Birthday, {bday_name}!* 🎉🎂\n\n{resp.text.strip()}"
        except Exception as e:
            print(f"Birthday wish fallback: {e}")

        state["ui_action"] = {
            "action": "SHOW_BIRTHDAY",
            "name": bday_name,
            "restaurant_name": restaurant_name,
            "wish": wish_text,
        }
        state["final_response"] = {
            "type": "buttons",
            "body": wish_text,
            "buttons": [
                {"id": "show_menu", "title": "🍰 Order Dessert"},
                {"id": "tell_joke", "title": "😂 Birthday Joke"},
            ],
        }

        # Also notify the kitchen/staff board that a table is celebrating a birthday
        if branch_id:
            try:
                await manager.broadcast_to_branch(str(branch_id), {
                    "event": "BIRTHDAY_CELEBRATION",
                    "table_number": table_num,
                    "birthday_name": bday_name,
                })
            except Exception:
                pass

        return state

    return state

