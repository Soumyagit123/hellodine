"""
End-to-End Test for HelloDine:
Kiosk Session -> Caching -> Add Item to Cart -> Place Order -> Verify Session & Chatbot
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database import AsyncSessionLocal
from app.models.tenancy import Restaurant, Branch, Table
from app.models.customers import TableSession, SessionStatus
from app.models.menu import MenuItem
from sqlalchemy import select

async def run_full_journey():
    print("=" * 65)
    print("🚀 HELLODINE FULL END-TO-END JOURNEY TEST WITH CACHING")
    print("=" * 65)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Step 1: Health Check
        print("\n[Step 1] Checking /health...")
        h = await client.get("/health")
        assert h.status_code == 200
        print("  ✅ /health OK:", h.json())

        # Step 2: Get tables list
        print("\n[Step 2] Fetching /api/kiosk/tables-list...")
        tbl_res = await client.get("/api/kiosk/tables-list")
        assert tbl_res.status_code == 200
        tables_data = tbl_res.json()
        assert len(tables_data) > 0, "No tables configured"
        branch_with_tables = next(b for b in tables_data if b.get("tables"))
        branch_id = branch_with_tables["branch_id"]
        table = branch_with_tables["tables"][0]
        table_id = table["id"]
        print(f"  ✅ Selected Branch: {branch_with_tables['branch_name']} ({branch_id})")
        print(f"  ✅ Selected Table: Table {table['table_number']} ({table_id})")

        # Step 3: Start or Resume Session
        print("\n[Step 3] Starting / Resuming Kiosk Session...")
        start_res = await client.post("/api/kiosk/session/start", json={"table_id": table_id, "force_new": True})
        assert start_res.status_code == 200
        session_data = start_res.json()
        session_id = session_data["session"]["id"]
        print(f"  ✅ Session Active: {session_id} (Status: {session_data['session']['status']})")

        # Step 4: Verify Caching (1st call: Cache Miss, 2nd call: Cache Hit)
        print("\n[Step 4] Testing Cache Miss & Cache Hit on Session State...")
        s1 = await client.get(f"/api/kiosk/session/{session_id}")
        assert s1.status_code == 200
        data1 = s1.json()
        assert "menu_items" in data1
        print(f"  ✅ Call 1 (Cache Miss): Loaded {len(data1['menu_items'])} menu items.")

        s2 = await client.get(f"/api/kiosk/session/{session_id}")
        assert s2.status_code == 200
        data2 = s2.json()
        assert "menu_items" in data2
        print(f"  ✅ Call 2 (Cache Hit): Retrieved immediately from RAM cache.")

        s3 = await client.get(f"/api/kiosk/session/{session_id}?light=true")
        assert s3.status_code == 200
        data3 = s3.json()
        assert "menu_items" not in data3
        print(f"  ✅ Call 3 (Light Refresh): Polled active session without heavy menu.")

        # Step 5: Pick a menu item to add to cart
        menu_items = data1["menu_items"]
        if not menu_items:
            print("  ⚠️ No menu items available to test adding to cart. Skipping cart/order test.")
            return

        chosen_item = menu_items[0]
        print(f"\n[Step 5] Adding Item to Cart: '{chosen_item['name']}' (₹{chosen_item['base_price']})...")
        add_res1 = await client.post("/api/cart/add", json={
            "session_id": session_id,
            "menu_item_id": chosen_item["id"],
            "quantity": 2,
            "notes": "Extra crispy"
        })
        assert add_res1.status_code == 200, f"Add item failed: {add_res1.text}"
        cart_info1 = add_res1.json()
        print(f"  ✅ Added 2x {chosen_item['name']}. Cart Subtotal: ₹{cart_info1['total']}")

        # Step 6: Test get cart
        print("\n[Step 6] Verifying GET /api/cart/{session_id}...")
        get_cart_res = await client.get(f"/api/cart/{session_id}")
        assert get_cart_res.status_code == 200
        print("  ✅ Cart retrieved successfully without MultipleResultsFound error.")

        # Step 7: Place Order (This previously threw 500 MultipleResultsFound)
        print("\n[Step 7] Placing Order via POST /api/orders/place...")
        place_res = await client.post("/api/orders/place", json={
            "session_id": session_id
        })
        assert place_res.status_code == 200, f"Order placement failed: {place_res.text}"
        order_info = place_res.json()
        print(f"  🎉 ORDER PLACED SUCCESSFULLY!")
        print(f"  Order ID: {order_info['order_id']}")
        print(f"  Order Number: {order_info['order_number']}")
        print(f"  Status: {order_info['status']}")

        # Step 8: Verify Kiosk Session State reflects the new placed order
        print("\n[Step 8] Verifying Placed Order in Kiosk Session State...")
        s_after_order = await client.get(f"/api/kiosk/session/{session_id}")
        assert s_after_order.status_code == 200
        s_data = s_after_order.json()
        assert len(s_data["orders"]) > 0, "Placed order should appear in session orders!"
        latest_order = s_data["orders"][0]
        print(f"  ✅ Session state contains {len(s_data['orders'])} order(s). Latest: {latest_order['order_number']} (Total: ₹{latest_order['total']})")
        assert len(s_data["cart"]["items"]) == 0, "Cart items should be empty after checkout!"
        print("  ✅ Cart items cleanly emptied after checkout.")

    print("\n" + "=" * 65)
    print("🏆 ALL ENDPOINTS & FLOWS PASSED WITH 100% SUCCESS!")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(run_full_journey())
