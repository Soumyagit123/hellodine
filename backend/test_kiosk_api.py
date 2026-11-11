"""
Integration test for Kiosk API endpoints and _serialize_session_state.
Verifies:
1. First load (Cache Miss) works.
2. Second load (Cache Hit) works without UnboundLocalError.
3. Light refresh (include_static_menu=False) works without UnboundLocalError.
4. FastAPI app mounts and runs health/tables-list endpoints cleanly.
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
from app.routers.kiosk import _serialize_session_state
from sqlalchemy import select

async def run_tests():
    print("=" * 60)
    print("🧪 RUNNING KIOSK API & CACHE VERIFICATION TEST")
    print("=" * 60)
    
    # 1. Test basic app routing with ASGI transport
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/health")
        print(f"  GET /health -> status {res.status_code}: {res.json()}")
        assert res.status_code == 200, "Health check failed"

        res_tables = await client.get("/api/kiosk/tables-list")
        print(f"  GET /api/kiosk/tables-list -> status {res_tables.status_code}")
        assert res_tables.status_code == 200, "Tables list failed"
        tables_data = res_tables.json()
        print(f"  Found {len(tables_data)} branch configurations.")

    # 2. Test _serialize_session_state directly with an actual active table session
    async with AsyncSessionLocal() as db:
        # Find any existing table session
        session_res = await db.execute(select(TableSession).limit(1))
        test_session = session_res.scalar_one_or_none()

        if test_session:
            print(f"\n[TEST] Testing TableSession {test_session.id} (Status: {test_session.status}):")
            
            # Call 1: include_static_menu=True (Populates Cache)
            state_1 = await _serialize_session_state(test_session, db, include_static_menu=True)
            assert "restaurant" in state_1, "Missing restaurant in initial load"
            print("  ✅ Call 1 (Cache Miss / Static Menu) passed.")

            # Call 2: include_static_menu=True (Uses Cache Hit - this was where UnboundLocalError crashed)
            state_2 = await _serialize_session_state(test_session, db, include_static_menu=True)
            assert "restaurant" in state_2, "Missing restaurant in cache hit load"
            print("  ✅ Call 2 (Cache Hit / Static Menu) passed cleanly without UnboundLocalError!")

            # Call 3: include_static_menu=False (Light polling refresh)
            state_3 = await _serialize_session_state(test_session, db, include_static_menu=False)
            assert "session" in state_3, "Missing session in light refresh"
            assert "restaurant" not in state_3, "Static menu should not be in light refresh"
            print("  ✅ Call 3 (Light Refresh / no static menu) passed cleanly!")
        else:
            print("  Note: No existing TableSession in DB, skipping direct session state test.")

    print("\n" + "=" * 60)
    print("🎉 KIOSK API TEST PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(run_tests())
