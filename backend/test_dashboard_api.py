import sys
import uuid
from fastapi.testclient import TestClient
from app.main import app

def test_dashboard_api():
    print("Initializing FastAPI TestClient...")
    client = TestClient(app)
    
    # We use the branch ID from previous logs
    branch_id = "70d0ca23-a03a-4d7b-a262-f075593cdde7"
    
    print(f"Sending GET request to /api/billing/report/dashboard?branch_id={branch_id}...")
    try:
        response = client.get(f"/api/billing/report/dashboard?branch_id={branch_id}")
        
        print("\n--- RESPONSE ---")
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print("Today's Revenue:", data.get("today", {}).get("total_revenue"))
            print("MTD Revenue:", data.get("month", {}).get("total_revenue"))
            print("All Time Revenue:", data.get("all_time", {}).get("total_revenue"))
            print(f"Trend Array Length: {len(data.get('trend_7d', []))} days")
            print("Trend Data Sample:", data.get("trend_7d", [])[-1])
            print("✅ API INTEGRATION TEST PASSED!")
        else:
            print("❌ API FAILED:", response.text)
            sys.exit(1)
            
    except Exception as e:
        print(f"❌ FATAL ERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    test_dashboard_api()
