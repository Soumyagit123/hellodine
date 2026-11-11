"""
Test the Kitchen & Cashier order status flow:
NEW -> ACCEPTED -> PREPARING -> READY -> SERVED
Measures latency for each click/transition.
"""
import sys
import os
import time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app

async def run_kitchen_flow_test():
    print("=" * 65)
    print("👨‍🍳 KITCHEN & CASHIER STATUS TRANSITIONS SPEED TEST")
    print("=" * 65)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Step 1: Find an active order to test
        tbl_res = await client.get("/api/kiosk/tables-list")
        assert tbl_res.status_code == 200
        tables_data = tbl_res.json()
        branch_with_tables = next(b for b in tables_data if b.get("tables"))
        branch_id = branch_with_tables["branch_id"]
        table_id = branch_with_tables["tables"][0]["id"]

        # Start session and place an order
        s_res = await client.post("/api/kiosk/session/start", json={"table_id": table_id, "force_new": True})
        session_id = s_res.json()["session"]["id"]
        s_data = await client.get(f"/api/kiosk/session/{session_id}")
        items = s_data.json()["menu_items"]
        assert len(items) > 0, "No menu items to test"
        
        # Add item to cart
        await client.post("/api/cart/add", json={
            "session_id": session_id,
            "menu_item_id": items[0]["id"],
            "quantity": 1
        })
        
        # Place order
        place_res = await client.post("/api/orders/place", json={"session_id": session_id})
        order_id = place_res.json()["order_id"]
        order_num = place_res.json()["order_number"]
        print(f"Created Test Order #{order_num} ({order_id}) with status NEW\n")

        # Step 2: Step-by-Step Transition Test
        transitions = [
            ("ACCEPTED", "Kitchen Boy: Accept Order (NEW -> ACCEPTED)"),
            ("PREPARING", "Kitchen Boy: Start Prep (ACCEPTED -> PREPARING)"),
            ("READY", "Kitchen Boy: Mark Ready (PREPARING -> READY)"),
            ("SERVED", "Cashier/Waiter: Mark Served (READY -> SERVED)"),
        ]

        for next_status, label in transitions:
            t0 = time.perf_counter()
            res = await client.patch(f"/api/orders/{order_id}/status", json={"status": next_status})
            t1 = time.perf_counter()
            elapsed_ms = (t1 - t0) * 1000
            assert res.status_code == 200, f"Status update failed: {res.text}"
            print(f"  🔘 {label}")
            print(f"     Status: HTTP {res.status_code} | Latency: {elapsed_ms:.2f} ms")

        # Step 3: Verify Kitchen Board Fetch Speed after updates
        t0 = time.perf_counter()
        board_res = await client.get(f"/api/orders?branch_id={branch_id}")
        t1 = time.perf_counter()
        elapsed_board = (t1 - t0) * 1000
        assert board_res.status_code == 200
        print(f"\n  📋 Kitchen Board Reload Latency: {elapsed_board:.2f} ms")

    print("\n" + "=" * 65)
    print("🎉 ALL KITCHEN & CASHIER TRANSITIONS COMPLETED!")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(run_kitchen_flow_test())

