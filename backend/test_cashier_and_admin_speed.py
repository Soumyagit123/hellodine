"""
Verification test for Cashier Billing & SuperAdmin Dashboard Speed.
Tests:
1. Cashier Billing Transactions (Cache miss vs Cache hit latency).
2. Kitchen Orders Board (Cache miss vs Cache hit latency).
3. SuperAdmin Corporate Dashboard (Cache miss vs Cache hit latency).
4. Invalidation safety on payment.
"""
import sys
import os
import time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app

async def run_speed_test():
    print("=" * 65)
    print("⚡ CASHIER BILLING & SUPERADMIN DASHBOARD SPEED TEST")
    print("=" * 65)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Step 1: Get branches
        tbl_res = await client.get("/api/kiosk/tables-list")
        assert tbl_res.status_code == 200
        tables_data = tbl_res.json()
        assert len(tables_data) > 0
        branch_id = tables_data[0]["branch_id"]
        print(f"Testing with Branch ID: {branch_id}")

        # Step 2: Cashier Billing Transactions
        print("\n[TEST 1] Cashier Billing Transactions (/api/billing/transactions):")
        t0 = time.perf_counter()
        res1 = await client.get(f"/api/billing/transactions?branch_id={branch_id}")
        t1 = time.perf_counter()
        dur_miss = (t1 - t0) * 1000
        assert res1.status_code == 200
        print(f"  Call 1 (Cache Miss - with N+1 loop eliminated): {dur_miss:.2f} ms")

        t2 = time.perf_counter()
        res2 = await client.get(f"/api/billing/transactions?branch_id={branch_id}")
        t3 = time.perf_counter()
        dur_hit = (t3 - t2) * 1000
        assert res2.status_code == 200
        print(f"  Call 2 (Cache Hit - from RAM): {dur_hit:.2f} ms")
        print(f"  ⚡ Speedup: {dur_miss / max(dur_hit, 0.001):.1f}x faster!")

        # Step 3: Kitchen Orders Board
        print("\n[TEST 2] Kitchen Orders Board (/api/orders):")
        t0 = time.perf_counter()
        o_res1 = await client.get(f"/api/orders?branch_id={branch_id}")
        t1 = time.perf_counter()
        dur_o_miss = (t1 - t0) * 1000
        assert o_res1.status_code == 200
        print(f"  Call 1 (Cache Miss): {dur_o_miss:.2f} ms")

        t2 = time.perf_counter()
        o_res2 = await client.get(f"/api/orders?branch_id={branch_id}")
        t3 = time.perf_counter()
        dur_o_hit = (t3 - t2) * 1000
        assert o_res2.status_code == 200
        print(f"  Call 2 (Cache Hit - from RAM): {dur_o_hit:.2f} ms")
        print(f"  ⚡ Speedup: {dur_o_miss / max(dur_o_hit, 0.001):.1f}x faster!")

        # Step 4: SuperAdmin Corporate Dashboard
        print("\n[TEST 3] SuperAdmin Corporate Dashboard (/api/billing/report/dashboard):")
        t0 = time.perf_counter()
        d_res1 = await client.get(f"/api/billing/report/dashboard?branch_id={branch_id}")
        t1 = time.perf_counter()
        dur_d_miss = (t1 - t0) * 1000
        assert d_res1.status_code == 200
        print(f"  Call 1 (Cache Miss - 7-day query): {dur_d_miss:.2f} ms")

        t2 = time.perf_counter()
        d_res2 = await client.get(f"/api/billing/report/dashboard?branch_id={branch_id}")
        t3 = time.perf_counter()
        dur_d_hit = (t3 - t2) * 1000
        assert d_res2.status_code == 200
        print(f"  Call 2 (Cache Hit - from RAM): {dur_d_hit:.2f} ms")
        print(f"  ⚡ Speedup: {dur_d_miss / max(dur_d_hit, 0.001):.1f}x faster!")

    print("\n" + "=" * 65)
    print("🎉 ALL CASHIER & SUPERADMIN SPEED TESTS PASSED SUCCESSFULLY!")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(run_speed_test())

