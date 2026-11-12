import { useState, useEffect } from "react";
import { QRCodeCanvas } from "qrcode.react";
import client from "../../api/client";

interface Branch {
    id: string;
    restaurant_id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    gstin?: string;
    created_at: string;
}

export default function BranchAdmin() {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [restaurant, setRestaurant] = useState<any>(null);
    const [saasConfig, setSaasConfig] = useState<any>(null);
    const [maxBranches, setMaxBranches] = useState(1);
    const [merchantUpiInput, setMerchantUpiInput] = useState("");
    const [savingUpi, setSavingUpi] = useState(false);

    // Subscription Renewal Modal State
    const [selectedPlanForPay, setSelectedPlanForPay] = useState<any | null>(null);
    const [utrInput, setUtrInput] = useState("");
    const [submittingRenewal, setSubmittingRenewal] = useState(false);

    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
    const [formData, setFormData] = useState({
        name: "",
        address: "",
        city: "",
        state: "",
        pincode: "",
        gstin: ""
    });

    const staffData = JSON.parse(localStorage.getItem("hd_staff") || "{}");
    const restaurantId = staffData.restaurant_id;

    useEffect(() => {
        if (restaurantId) {
            Promise.all([
                fetchBranches(),
                fetchRestaurantInfo()
            ]).finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, [restaurantId]);

    const fetchBranches = async () => {
        try {
            const res = await client.get(`/admin/branches?restaurant_id=${restaurantId}`);
            setBranches(res.data);
        } catch (err) {
            console.error("Failed to fetch branches", err);
        }
    };

    const fetchRestaurantInfo = async () => {
        try {
            const [res, plansRes] = await Promise.all([
                client.get(`/admin/restaurants/${restaurantId}`),
                client.get("/admin/saas/plans"),
            ]);
            if (res.data) {
                setRestaurant(res.data);
                setMaxBranches(res.data.max_branches || 1);
                setMerchantUpiInput(res.data.merchant_upi_id || "");
            }
            if (plansRes.data) {
                setSaasConfig(plansRes.data);
            }
        } catch (err) {
            console.error("Failed to fetch restaurant info", err);
        }
    };

    const handleSaveMerchantUpi = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!restaurantId) return;
        setSavingUpi(true);
        try {
            const res = await client.patch(`/admin/restaurants/${restaurantId}`, {
                merchant_upi_id: merchantUpiInput.trim(),
            });
            setRestaurant(res.data);
            alert("✅ Merchant UPI ID saved! All Table QR invoices for your restaurant will now receive money directly to this UPI ID.");
        } catch {
            alert("Failed to update Merchant UPI ID");
        } finally {
            setSavingUpi(false);
        }
    };

    const handleSubmitRenewal = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedPlanForPay || !utrInput.trim()) return;
        setSubmittingRenewal(true);
        try {
            await client.post(`/admin/restaurants/${restaurantId}/request-renewal`, {
                plan: selectedPlanForPay.id,
                utr_reference: utrInput.trim(),
                amount: selectedPlanForPay.price_monthly,
            });
            setSelectedPlanForPay(null);
            setUtrInput("");
            await fetchRestaurantInfo();
            alert("✅ Subscription payment submitted! The HelloDine SaaS Provider has been notified to activate your renewal.");
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to submit renewal");
        } finally {
            setSubmittingRenewal(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await client.post("/admin/branches", {
                ...formData,
                restaurant_id: restaurantId
            });
            setFormData({ name: "", address: "", city: "", state: "", pincode: "", gstin: "" });
            setShowAdd(false);
            fetchBranches();
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to create branch");
        }
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingBranch) return;
        try {
            await client.patch(`/admin/branches/${editingBranch.id}`, formData);
            setEditingBranch(null);
            fetchBranches();
            alert("✅ Branch details updated successfully!");
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to update branch");
        }
    };

    const handleDeleteBranch = async (branch: Branch) => {
        if (!window.confirm(`Are you sure you want to delete branch "${branch.name}"? This action cannot be undone.`)) return;
        try {
            await client.delete(`/admin/branches/${branch.id}`);
            fetchBranches();
            alert(`✅ Branch "${branch.name}" deleted.`);
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to delete branch");
        }
    };

    const selectBranch = (branch: Branch) => {
        localStorage.setItem("hd_selected_branch", branch.id);
        localStorage.setItem("hd_selected_branch_name", branch.name);
        window.location.href = "/admin/tables";
    };

    if (loading) return <div className="p-8">Loading Branch Manager...</div>;

    const limitReached = branches.length >= maxBranches;

    return (
        <div className="p-8">
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
                <div>
                    <h1 style={{ fontSize: "2rem", fontWeight: 800 }}>Manage Branches</h1>
                    <p style={{ color: "var(--text-muted)" }}>
                        You are using <strong>{branches.length}</strong> of <strong>{maxBranches}</strong> allowed branches.
                    </p>
                </div>
                {!limitReached ? (
                    <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add Branch</button>
                ) : (
                    <button className="btn-secondary" style={{ opacity: 0.6, cursor: "not-allowed" }} title="Limit reached">
                        Limit Reached
                    </button>
                )}
            </header>

            {showAdd && (
                <div className="modal-overlay">
                    <div className="modal" style={{ maxWidth: "600px" }}>
                        <h2>Add New Branch</h2>
                        <form onSubmit={handleCreate} style={{ marginTop: "20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                            <div className="input-group" style={{ gridColumn: "span 2" }}>
                                <label className="input-label">Branch Name</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Indiranagar Outlet"
                                />
                            </div>
                            <div className="input-group" style={{ gridColumn: "span 2" }}>
                                <label className="input-label">Address</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.address}
                                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                                    placeholder="Full street address"
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">City</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.city}
                                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">State</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.state}
                                    onChange={e => setFormData({ ...formData, state: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Pincode</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.pincode}
                                    onChange={e => setFormData({ ...formData, pincode: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">GSTIN (Optional)</label>
                                <input
                                    className="input"
                                    value={formData.gstin}
                                    onChange={e => setFormData({ ...formData, gstin: e.target.value })}
                                />
                            </div>
                            <div style={{ display: "flex", gap: "12px", marginTop: "12px", gridColumn: "span 2" }}>
                                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Create Branch</button>
                                <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "24px" }}>
                {branches.map(b => (
                    <div key={b.id} className="card" style={{ padding: "24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                            <h3 style={{ fontSize: "1.2rem", fontWeight: 700 }}>{b.name}</h3>
                            <span className="badge-ready">ACTIVE</span>
                        </div>
                        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: "1.6", marginBottom: "16px" }}>
                            📍 {b.address}<br />
                            {b.city}, {b.state} - {b.pincode}
                        </p>
                        {b.gstin && (
                            <div style={{ fontSize: "0.8rem", color: "var(--accent)", marginBottom: "16px" }}>
                                🧾 GSTIN: {b.gstin}
                            </div>
                        )}
                        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            <button
                                className="btn-primary"
                                style={{ padding: "8px 14px", fontSize: "0.8rem", flex: 1 }}
                                onClick={() => selectBranch(b)}
                                title="Set active branch and open Tables Management"
                            >
                                ⚡ Manage This Branch
                            </button>
                            <button
                                className="btn-secondary"
                                style={{ padding: "8px 14px", fontSize: "0.8rem" }}
                                title="Edit Branch Information"
                                onClick={() => {
                                    setEditingBranch(b);
                                    setFormData({
                                        name: b.name,
                                        address: b.address,
                                        city: b.city,
                                        state: b.state,
                                        pincode: b.pincode,
                                        gstin: b.gstin || "",
                                    });
                                }}
                            >
                                ✏️ Edit
                            </button>
                            <button
                                className="btn-secondary"
                                style={{ padding: "8px 12px", fontSize: "0.8rem", color: "var(--red)", borderColor: "rgba(255,95,87,0.3)" }}
                                title="Delete Branch"
                                onClick={() => handleDeleteBranch(b)}
                            >
                                🗑️
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Edit Branch Modal */}
            {editingBranch && (
                <div className="modal-overlay" onClick={() => setEditingBranch(null)}>
                    <div className="card modal" style={{ maxWidth: "550px" }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                            <h2 style={{ fontSize: "1.3rem", fontWeight: 700 }}>✏️ Edit Branch: {editingBranch.name}</h2>
                            <button className="btn-secondary" onClick={() => setEditingBranch(null)}>✕</button>
                        </div>
                        <form onSubmit={handleUpdate} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                            <div className="input-group" style={{ gridColumn: "span 2" }}>
                                <label className="input-label">Branch Name</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                            <div className="input-group" style={{ gridColumn: "span 2" }}>
                                <label className="input-label">Address</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.address}
                                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">City</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.city}
                                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">State</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.state}
                                    onChange={e => setFormData({ ...formData, state: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Pincode</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.pincode}
                                    onChange={e => setFormData({ ...formData, pincode: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Branch GSTIN (Optional)</label>
                                <input
                                    className="input"
                                    value={formData.gstin}
                                    onChange={e => setFormData({ ...formData, gstin: e.target.value })}
                                />
                            </div>
                            <div style={{ display: "flex", gap: "12px", marginTop: "12px", gridColumn: "span 2" }}>
                                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Save Branch Changes</button>
                                <button type="button" className="btn-secondary" onClick={() => setEditingBranch(null)}>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {limitReached && (
                <div style={{
                    marginTop: "32px",
                    padding: "24px",
                    background: "rgba(255,159,67,0.05)",
                    borderRadius: "var(--radius)",
                    border: "1px dashed var(--orange)",
                    textAlign: "center"
                }}>
                    <p style={{ color: "var(--orange)", fontWeight: 600 }}>
                        ⚠️ You have reached your branch limit ({maxBranches}).
                    </p>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "4px" }}>
                        To open more locations, please upgrade your subscription plan below.
                    </p>
                </div>
            )}

            {/* ─── MERCHANT UPI ID SETTING (FOR CUSTOMER TABLE QR PAYMENTS) ─────────── */}
            <div className="card" style={{ marginTop: "36px", padding: "24px" }}>
                <h2 style={{ fontSize: "1.35rem", fontWeight: 800, marginBottom: "6px" }}>
                    🏦 Restaurant Merchant UPI ID (Table QR Payment Receiver)
                </h2>
                <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginBottom: "16px" }}>
                    Enter your restaurant's official UPI ID (Google Pay Business / PhonePe / Paytm / Bank VPA). When customers scan the GST Bill QR code at any table, 100% of their payment goes directly to this UPI account.
                </p>
                <form onSubmit={handleSaveMerchantUpi} style={{ display: "flex", gap: "12px", maxWidth: "560px", flexWrap: "wrap" }}>
                    <input
                        className="input"
                        style={{ flex: 1, minWidth: "260px" }}
                        placeholder="e.g. yourrestaurant@okaxis or 9876543210@ybl"
                        value={merchantUpiInput}
                        onChange={(e) => setMerchantUpiInput(e.target.value)}
                        required
                    />
                    <button type="submit" className="btn btn-primary" disabled={savingUpi}>
                        {savingUpi ? "Saving…" : "💾 Save Merchant UPI ID"}
                    </button>
                </form>
            </div>

            {/* ─── SAAS SUBSCRIPTION & PLAN MANAGEMENT (PHASE 1: DIRECT UPI QR) ─────── */}
            <div className="card" style={{ marginTop: "28px", padding: "24px", border: "1px solid rgba(255,107,53,0.35)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "20px" }}>
                    <div>
                        <h2 style={{ fontSize: "1.35rem", fontWeight: 800 }}>
                            🚀 HelloDine SaaS Subscription & Plan
                        </h2>
                        <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>
                            Current Plan:{" "}
                            <strong style={{ color: "var(--green)" }}>
                                {restaurant?.subscription_plan || "STARTER"} ({restaurant?.subscription_status || "ACTIVE"})
                            </strong>
                            {restaurant?.subscription_expires_at && (
                                <> · Valid until <strong>{new Date(restaurant.subscription_expires_at).toLocaleDateString()}</strong></>
                            )}
                        </p>
                    </div>
                    {restaurant?.pending_renewal_plan && (
                        <div className="badge" style={{ background: "rgba(255,159,67,0.2)", color: "var(--orange)", padding: "8px 14px" }}>
                            ⏳ Pending Verification: {restaurant.pending_renewal_plan} (UTR: {restaurant.pending_renewal_utr})
                        </div>
                    )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(275px, 1fr))", gap: "18px" }}>
                    {(saasConfig?.plans || []).map((plan: any) => {
                        const isCurrent = (restaurant?.subscription_plan || "STARTER") === plan.id;
                        return (
                            <div
                                key={plan.id}
                                style={{
                                    background: "rgba(255,255,255,0.03)",
                                    border: isCurrent ? "2px solid var(--green)" : "1px solid var(--border)",
                                    borderRadius: "14px",
                                    padding: "20px",
                                    display: "flex",
                                    flexDirection: "column",
                                    justifyContent: "space-between",
                                }}
                            >
                                <div>
                                    <div className="badge badge-new" style={{ marginBottom: "8px" }}>{plan.badge}</div>
                                    <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "6px" }}>{plan.name}</h3>
                                    <div style={{ fontSize: "1.7rem", fontWeight: 900, color: "var(--green)", marginBottom: "14px" }}>
                                        ₹{plan.price_monthly}
                                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 500 }}>
                                            {" "}/ {plan.duration_days === 365 ? "year" : "month"}
                                        </span>
                                    </div>
                                    <ul style={{ paddingLeft: "18px", fontSize: "0.83rem", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: "18px" }}>
                                        {(plan.features || []).map((f: string, idx: number) => (
                                            <li key={idx}>✅ {f}</li>
                                        ))}
                                    </ul>
                                </div>
                                <button
                                    className="btn btn-primary"
                                    style={{ width: "100%", justifyContent: "center" }}
                                    onClick={() => setSelectedPlanForPay(plan)}
                                >
                                    {isCurrent ? "💳 Renew Current Plan" : "⚡ Subscribe / Upgrade via UPI QR"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ─── MODAL: SCAN SAAS OWNER UPI QR TO SUBSCRIBE / RENEW ──────────────── */}
            {selectedPlanForPay && saasConfig && (
                <div className="modal-overlay" onClick={() => setSelectedPlanForPay(null)}>
                    <div className="card modal" style={{ maxWidth: "460px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: "6px" }}>💳 Subscribe: {selectedPlanForPay.name}</h2>
                        <p className="text-muted text-sm" style={{ marginBottom: "16px" }}>
                            Scan with GPay, PhonePe, or Paytm to pay <strong>{saasConfig.owner_name}</strong> (0% Gateway Fee):
                        </p>

                        <div style={{ background: "#fff", padding: "16px", borderRadius: "12px", display: "inline-block", marginBottom: "12px" }}>
                            <QRCodeCanvas
                                value={`upi://pay?pa=${encodeURIComponent(saasConfig.owner_upi_id)}&pn=${encodeURIComponent(
                                    saasConfig.owner_name
                                )}&am=${selectedPlanForPay.price_monthly}&cu=INR&tn=${encodeURIComponent(
                                    `HelloDine_${selectedPlanForPay.id}_${restaurant?.name || "Sub"}`
                                )}`}
                                size={185}
                                level="H"
                                includeMargin={true}
                            />
                        </div>

                        <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "var(--green)", marginBottom: "4px" }}>
                            Amount: ₹{selectedPlanForPay.price_monthly}
                        </div>
                        <div className="text-muted text-sm" style={{ marginBottom: "16px" }}>
                            Payable to UPI ID: <strong>{saasConfig.owner_upi_id}</strong>
                        </div>

                        <form onSubmit={handleSubmitRenewal}>
                            <div className="input-group" style={{ textAlign: "left" }}>
                                <label className="input-label">Enter 12-Digit UPI Ref / UTR Number after payment</label>
                                <input
                                    className="input"
                                    placeholder="e.g. 431289451209"
                                    value={utrInput}
                                    onChange={(e) => setUtrInput(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="flex gap-2">
                                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setSelectedPlanForPay(null)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-success" style={{ flex: 1 }} disabled={submittingRenewal}>
                                    {submittingRenewal ? "Submitting…" : "✅ Submit Payment UTR"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
