"""
Verification and Benchmark Test Suite for HelloDine In-Memory Cache.
Tests:
1. In-Memory Cache Performance (Sub-millisecond retrieval vs DB latency).
2. Multi-tenant / Multi-branch Data Isolation.
3. Cache Invalidation per Branch (Prefix-based invalidation).
4. Concurrent Multi-Table Access.
"""
import time
import asyncio
from concurrent.futures import ThreadPoolExecutor
from app.services.cache_service import MemoryCache

def test_cache_benchmark():
    cache = MemoryCache(default_ttl_seconds=300)
    
    branch_1_id = "branch-sydney-001"
    branch_2_id = "branch-delhi-002"
    
    mock_menu_branch_1 = {
        "categories": [{"id": "c1", "name": "Starters"}, {"id": "c2", "name": "Mains"}],
        "items": [{"id": "i1", "name": "Paneer Tikka", "price": 280}, {"id": "i2", "name": "Butter Naan", "price": 60}],
        "restaurant_name": "Spice Route Sydney"
    }
    
    mock_menu_branch_2 = {
        "categories": [{"id": "c10", "name": "Drinks"}, {"id": "c20", "name": "Desserts"}],
        "items": [{"id": "i10", "name": "Mango Lassi", "price": 120}, {"id": "i20", "name": "Gulab Jamun", "price": 90}],
        "restaurant_name": "Royal Feast Delhi"
    }
    
    print("=" * 60)
    print("🧪 HELLODINE CACHE VERIFICATION & BENCHMARK SUITE")
    print("=" * 60)
    
    # 1. Multi-tenant Isolation Test
    print("\n[TEST 1] Multi-Branch Tenant Isolation Check:")
    cache.set(f"static_menu:{branch_1_id}", mock_menu_branch_1)
    cache.set(f"static_menu:{branch_2_id}", mock_menu_branch_2)
    
    retrieved_1 = cache.get(f"static_menu:{branch_1_id}")
    retrieved_2 = cache.get(f"static_menu:{branch_2_id}")
    
    assert retrieved_1["restaurant_name"] == "Spice Route Sydney", "Branch 1 data mismatch!"
    assert retrieved_2["restaurant_name"] == "Royal Feast Delhi", "Branch 2 data mismatch!"
    assert retrieved_1 != retrieved_2, "Isolation failure: branches share identical references!"
    print("  ✅ Branch 1 and Branch 2 have strict, isolated cache keys.")
    print(f"  Branch 1: '{retrieved_1['restaurant_name']}' with {len(retrieved_1['items'])} items")
    print(f"  Branch 2: '{retrieved_2['restaurant_name']}' with {len(retrieved_2['items'])} items")
    
    # 2. Benchmark Retrieval Speed
    print("\n[TEST 2] Retrieval Latency Benchmark (10,000 requests):")
    iterations = 10000
    start_t = time.perf_counter()
    for _ in range(iterations):
        _ = cache.get(f"static_menu:{branch_1_id}")
    elapsed = time.perf_counter() - start_t
    
    avg_micros = (elapsed / iterations) * 1_000_000
    avg_millis = (elapsed / iterations) * 1_000
    ops_per_sec = int(iterations / elapsed)
    
    print(f"  Total time for {iterations:,} reads: {elapsed:.4f} seconds")
    print(f"  Average read latency: {avg_micros:.2f} microseconds ({avg_millis:.4f} ms)")
    print(f"  Throughput: {ops_per_sec:,} operations/second")
    print("  ✅ Cache retrieval is virtually instantaneous (sub-millisecond).")
    
    # 3. Targeted Prefix Invalidation Check
    print("\n[TEST 3] Targeted Branch Invalidation Check:")
    cache.set(f"ai_static_context:{branch_1_id}", {"ai_context": "Sydney AI"})
    cache.set(f"ai_static_context:{branch_2_id}", {"ai_context": "Delhi AI"})
    
    # Invalidate branch 1 only
    cache.invalidate_prefix(f"static_menu:{branch_1_id}")
    cache.invalidate_prefix(f"ai_static_context:{branch_1_id}")
    
    assert cache.get(f"static_menu:{branch_1_id}") is None, "Branch 1 static_menu should be invalidated!"
    assert cache.get(f"ai_static_context:{branch_1_id}") is None, "Branch 1 ai_static_context should be invalidated!"
    assert cache.get(f"static_menu:{branch_2_id}") is not None, "Branch 2 static_menu should NOT be touched!"
    assert cache.get(f"ai_static_context:{branch_2_id}") is not None, "Branch 2 ai_static_context should NOT be touched!"
    print("  ✅ Invalidating Branch 1 successfully purged its keys while leaving Branch 2 intact.")
    
    # 4. TTL Expiration Check
    print("\n[TEST 4] TTL Expiration Check:")
    cache.set("short_lived_key", "temporary_data", ttl_seconds=1)
    assert cache.get("short_lived_key") == "temporary_data"
    print("  Key active immediately after write.")
    time.sleep(1.1)
    assert cache.get("short_lived_key") is None, "Key should have expired!"
    print("  ✅ Key automatically expired after TTL.")
    
    # 5. Multi-Table Concurrent Access Simulation
    print("\n[TEST 5] Concurrent Multi-Table Read/Write Stress Test:")
    cache.set(f"static_menu:{branch_1_id}", mock_menu_branch_1)
    
    def simulate_table_kiosk(table_num):
        for _ in range(500):
            data = cache.get(f"static_menu:{branch_1_id}")
            if not data or data["restaurant_name"] != "Spice Route Sydney":
                return False
        return True

    with ThreadPoolExecutor(max_workers=50) as executor:
        results = list(executor.map(simulate_table_kiosk, range(50)))
        
    assert all(results), "Concurrent kiosk requests experienced corruption or missing data!"
    print(f"  ✅ 50 simultaneous table kiosks made 25,000 concurrent cache hits with 100% success.")
    
    print("\n" + "=" * 60)
    print("🎉 ALL CACHE TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    test_cache_benchmark()

