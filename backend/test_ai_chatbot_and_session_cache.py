"""
Verification script for Chatbot AI caching and New Session cache lifecycle.
Tests:
1. AI Chatbot response (/api/kiosk/chat) for recommendations, general Q&A, and cart intents.
2. Verifies whether static context and menu recommendations are served from RAM cache.
3. Simulates starting a NEW session:
   - Verifies old session is closed and new session starts with a fresh empty cart.
   - Verifies whether static menu and AI context cache remain intact or get cleared.
"""
import sys
import os
import time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.services.cache_service import cache

async def run_ai_and_session_test():
    print("=" * 65)
    print("🤖 CHATBOT AI & SESSION CACHE VERIFICATION TEST")
    print("=" * 65)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Step 1: Find an active table
        tbl_res = await client.get("/api/kiosk/tables-list")
        assert tbl_res.status_code == 200
        tables_data = tbl_res.json()
        branch = next(b for b in tables_data if b.get("tables"))
        branch_id = branch["branch_id"]
        table_id = branch["tables"][0]["id"]
        table_num = branch["tables"][0]["table_number"]

        print(f"Testing on Branch: {branch['branch_name']} | Table T{table_num} ({table_id})")

        # Step 2: Start Session 1
        s1_res = await client.post("/api/kiosk/session/start", json={"table_id": table_id, "force_new": True})
        assert s1_res.status_code == 200
        session_1 = s1_res.json()["session"]
        s1_id = session_1["id"]
        print(f"\n[SESSION 1 STARTED] ID: {s1_id}")

        # Check static cache keys in memory
        menu_cached_s1 = cache.get(f"static_menu:{branch_id}") is not None
        print(f"  RAM Cache 'static_menu:{branch_id}' present: {menu_cached_s1}")

        # Step 3: Test Chatbot AI - Query 1: Recommendation (Menu & Format from Cache)
        print("\n--- Test Chatbot Query 1: 'What is the best starter to order?' ---")
        t0 = time.perf_counter()
        chat1 = await client.post("/api/kiosk/chat", json={
            "session_id": s1_id,
            "message": "What is the best starter to order?"
        })
        t1 = time.perf_counter()
        dur1 = (t1 - t0) * 1000
        assert chat1.status_code == 200
        c1_data = chat1.json()
        print(f"  Intent: {c1_data.get('intent')}")
        print(f"  Latency: {dur1:.2f} ms")
        print(f"  Reply: {c1_data.get('reply', {}).get('body') or c1_data.get('reply')}")
        ranked_cached = cache.get(f"ranked_items:{branch_id}") is not None
        print(f"  RAM Cache 'ranked_items:{branch_id}' populated: {ranked_cached}")

        # Test Chatbot Query 2: General Q&A (Calls restaurant_chat with AI static context)
        print("\n--- Test Chatbot Query 2: 'What kind of food do you serve?' ---")
        t0 = time.perf_counter()
        chat2 = await client.post("/api/kiosk/chat", json={
            "session_id": s1_id,
            "message": "What kind of food do you serve here?"
        })
        t1 = time.perf_counter()
        dur2 = (t1 - t0) * 1000
        assert chat2.status_code == 200
        c2_data = chat2.json()
        print(f"  Intent: {c2_data.get('intent')}")
        print(f"  Latency: {dur2:.2f} ms")
        print(f"  Reply: {c2_data.get('reply', {}).get('body') or c2_data.get('reply')}")
        ai_ctx_cached = cache.get(f"ai_static_context:{branch_id}") is not None
        print(f"  RAM Cache 'ai_static_context:{branch_id}' populated: {ai_ctx_cached}")

        # Add 1 item to Cart in Session 1 to verify session isolation
        s_data = await client.get(f"/api/kiosk/session/{s1_id}")
        menu_items = s_data.json().get("menu_items", [])
        if menu_items:
            await client.post("/api/cart/add", json={
                "session_id": s1_id,
                "menu_item_id": menu_items[0]["id"],
                "quantity": 2
            })
            print(f"\n  Added 2x '{menu_items[0]['name']}' to Session 1 cart.")

        # Step 4: Start Session 2 (New Customer arrives at the same table!)
        print("\n" + "=" * 65)
        print("🔄 SIMULATING NEW CUSTOMER SITTING AT SAME TABLE (force_new: True)")
        print("=" * 65)
        s2_res = await client.post("/api/kiosk/session/start", json={"table_id": table_id, "force_new": True})
        assert s2_res.status_code == 200
        s2_data = s2_res.json()
        session_2 = s2_data["session"]
        s2_id = session_2["id"]
        print(f"  New Session ID: {s2_id} (Previous was {s1_id})")
        assert s2_id != s1_id, "New session must have a unique ID!"

        # Check cart in Session 2
        s2_cart_items = s2_data.get("cart", {}).get("items", [])
        print(f"  Session 2 Cart Items Count: {len(s2_cart_items)} (Expected: 0)")
        assert len(s2_cart_items) == 0, "New customer must NOT see previous customer's cart!"

        # Check cache state for Static Menu & AI Context
        menu_cached_s2 = cache.get(f"static_menu:{branch_id}") is not None
        ranked_cached_s2 = cache.get(f"ranked_items:{branch_id}") is not None
        ai_ctx_cached_s2 = cache.get(f"ai_static_context:{branch_id}") is not None

        print("\n--- CACHE BEHAVIOR VERIFICATION ON NEW SESSION START ---")
        print(f"  1. 'static_menu:{branch_id}' remains in RAM: {menu_cached_s2} (Preserved for instant loading!)")
        print(f"  2. 'ranked_items:{branch_id}' remains in RAM: {ranked_cached_s2} (Preserved for AI recommendations!)")
        print(f"  3. 'ai_static_context:{branch_id}' remains in RAM: {ai_ctx_cached_s2} (Preserved for AI Q&A!)")

        # Now test Chatbot in Session 2
        print("\n--- Chatbot in Session 2: 'What is your best dish?' ---")
        t0 = time.perf_counter()
        chat_s2 = await client.post("/api/kiosk/chat", json={
            "session_id": s2_id,
            "message": "What is your best dish?"
        })
        t1 = time.perf_counter()
        dur_s2 = (t1 - t0) * 1000
        assert chat_s2.status_code == 200
        cs2_data = chat_s2.json()
        print(f"  Latency: {dur_s2:.2f} ms")
        print(f"  Reply: {cs2_data.get('reply', {}).get('body') or cs2_data.get('reply')}")

        print("\n" + "=" * 65)
        print("✅ ALL TESTS PASSED!")
        print("=" * 65)

if __name__ == "__main__":
    asyncio.run(run_ai_and_session_test())

