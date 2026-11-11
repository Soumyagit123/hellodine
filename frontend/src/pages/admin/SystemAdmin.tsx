import { useState, useEffect } from "react";
import client from "../../api/client";

interface Restaurant {
    id: string;
    name: string;
    gstin?: string;
    fssai_license_number?: string;
    merchant_upi_id?: string;
    subscription_plan?: string;
    subscription_status?: string;
    subscription_expires_at?: string;
    pending_renewal_plan?: string;
    pending_renewal_utr?: string;
    pending_renewal_amount?: number;
    whatsapp_display_number?: string;
    max_branches: number;
    is_active: boolean;
    created_at: string;
}

export default function SystemAdmin() {
    const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [editTarget, setEditTarget] = useState<Restaurant | null>(null);
    const [resetTarget, setResetTarget] = useState<Restaurant | null>(null);
    const [newPass, setNewPass] = useState("");
    const [formData, setFormData] = useState({
        name: "",
        contact_phone: "",
        gstin: "",
        fssai_license_number: "",
        merchant_upi_id: "",
        subscription_plan: "STARTER",
        max_branches: 1,
        owner_phone: "",
        owner_password: ""
    });

    useEffect(() => {
        fetchRestaurants();
    }, []);

    const fetchRestaurants = async () => {
        try {
            const res = await client.get("/admin/restaurants");
            setRestaurants(res.data);
        } catch (err) {
            console.error("Failed to fetch restaurants", err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            // 1. Create Restaurant (Kiosk SaaS — no Meta/WhatsApp API tokens required)
            const restRes = await client.post("/admin/restaurants", {
                name: formData.name,
                gstin: formData.gstin || undefined,
                fssai_license_number: formData.fssai_license_number || undefined,
                merchant_upi_id: formData.merchant_upi_id || undefined,
                subscription_plan: formData.subscription_plan || "STARTER",
                whatsapp_display_number: formData.contact_phone || formData.owner_phone,
                max_branches: formData.max_branches
            });

            const restaurantId = restRes.data.id;

            // 2. Create Owner Account (SUPER_ADMIN)
            await client.post("/admin/staff", {
                restaurant_id: restaurantId,
                role: "SUPER_ADMIN",
                name: `${formData.name} Owner`,
                phone: formData.owner_phone,
                password: formData.owner_password
            });

            setFormData({
                name: "",
                contact_phone: "",
                gstin: "",
                fssai_license_number: "",
                merchant_upi_id: "",
                subscription_plan: "STARTER",
                max_branches: 1,
                owner_phone: "",
                owner_password: ""
            });
            setShowAdd(false);
            fetchRestaurants();
            alert("Restaurant and Owner Account created successfully!");
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to create restaurant");
        }
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editTarget) return;
        try {
            await client.patch(`/admin/restaurants/${editTarget.id}`, {
                name: formData.name,
                gstin: formData.gstin || null,
                fssai_license_number: formData.fssai_license_number || null,
                merchant_upi_id: formData.merchant_upi_id || null,
                subscription_plan: formData.subscription_plan,
                whatsapp_display_number: formData.contact_phone || undefined,
                max_branches: formData.max_branches,
            });
            setEditTarget(null);
            fetchRestaurants();
        } catch (err) {
            alert("Failed to update restaurant");
        }
    };

    const handleApproveRenewal = async (r: Restaurant, days: number, planOverride?: string) => {
        try {
            await client.post(`/admin/restaurants/${r.id}/approve-renewal`, {
                days,
                plan: planOverride || r.pending_renewal_plan || r.subscription_plan || "STARTER",
            });
            fetchRestaurants();
            alert(`✅ Subscription activated for ${r.name} (+${days} days)!`);
        } catch {
            alert("Failed to approve subscription renewal");
        }
    };

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!resetTarget) return;
        try {
            await client.post(`/admin/restaurants/${resetTarget.id}/reset-owner-password`, {
                new_password: newPass
            });
            setResetTarget(null);
            setNewPass("");
            alert("Owner password reset successfully!");
        } catch (err) {
            alert("Failed to reset password");
        }
    }

    const openEdit = (r: Restaurant) => {
        setEditTarget(r);
        setFormData({
            ...formData,
            name: r.name,
            contact_phone: r.whatsapp_display_number || "",
            gstin: r.gstin || "",
            fssai_license_number: r.fssai_license_number || "",
            merchant_upi_id: r.merchant_upi_id || "",
            subscription_plan: r.subscription_plan || "STARTER",
            max_branches: r.max_branches
        });
    };

    if (loading) return <div className="p-8">Loading System Dashboard...</div>;

    return (
        <div className="p-8">
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
                <div>
                    <h1 style={{ fontSize: "2rem", fontWeight: 800 }}>Provider Dashboard</h1>
                    <p style={{ color: "var(--text-muted)" }}>Manage restaurants and branch limits</p>
                </div>
                <button className="btn-primary" onClick={() => { setEditTarget(null); setShowAdd(true); }}>+ Onboard Restaurant</button>
            </header>

            {resetTarget && (
                <div className="modal-overlay">
                    <div className="modal" style={{ maxWidth: "400px" }}>
                        <h2>Reset Owner Password</h2>
                        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", margin: "12px 0" }}>
                            Resetting password for <strong>{resetTarget.name}</strong> owner.
                        </p>
                        <form onSubmit={handleResetPassword}>
                            <div className="input-group">
                                <label className="input-label">New Password</label>
                                <input
                                    type="password"
                                    className="input"
                                    required
                                    value={newPass}
                                    onChange={e => setNewPass(e.target.value)}
                                    placeholder="Enter new complex password"
                                />
                            </div>
                            <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
                                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Reset Password</button>
                                <button type="button" className="btn-secondary" onClick={() => setResetTarget(null)}>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {(showAdd || editTarget) && (
                <div className="modal-overlay">
                    <div className="modal" style={{ maxWidth: "500px" }}>
                        <h2>{editTarget ? "Edit Restaurant" : "Onboard New Restaurant"}</h2>
                        <form onSubmit={editTarget ? handleUpdate : handleCreate} style={{ marginTop: "20px" }}>
                            <div className="input-group">
                                <label className="input-label">Restaurant Name</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Pizza Paradise"
                                />
                            </div>

                            {!editTarget && (
                                <div style={{ background: "rgba(255,255,255,0.03)", padding: "16px", borderRadius: "8px", marginBottom: "20px", border: "1px solid var(--border)" }}>
                                    <h3 style={{ fontSize: "0.9rem", marginBottom: "12px", color: "var(--orange)" }}>Initial Owner Account</h3>
                                    <div className="input-group">
                                        <label className="input-label">Owner Login ID (10-Digit Mobile or Custom Username)</label>
                                        <input
                                            className="input"
                                            required
                                            value={formData.owner_phone}
                                            onChange={e => setFormData({ ...formData, owner_phone: e.target.value })}
                                            placeholder="e.g. 9876543210 or pizza_owner"
                                        />
                                    </div>
                                    <div className="input-group" style={{ marginBottom: 0 }}>
                                        <label className="input-label">Owner Password</label>
                                        <input
                                            type="password"
                                            className="input"
                                            required
                                            value={formData.owner_password}
                                            onChange={e => setFormData({ ...formData, owner_password: e.target.value })}
                                            placeholder="Initial password"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="input-group">
                                <label className="input-label">Restaurant Merchant UPI ID (For Table QR Payments)</label>
                                <input
                                    className="input"
                                    value={formData.merchant_upi_id}
                                    onChange={e => setFormData({ ...formData, merchant_upi_id: e.target.value })}
                                    placeholder="e.g. restaurantname@okaxis or 9876543210@ybl"
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">SaaS Subscription Plan</label>
                                <select
                                    className="select"
                                    style={{ width: "100%" }}
                                    value={formData.subscription_plan}
                                    onChange={e => setFormData({ ...formData, subscription_plan: e.target.value })}
                                >
                                    <option value="STARTER">Starter Plan (₹1,999/mo — All Features Included)</option>
                                    <option value="PRO_AI">Pro AI Plan (₹3,499/mo — Multi-Branch & Future AI)</option>
                                    <option value="ANNUAL_PRO">Annual Plan (₹19,990/yr)</option>
                                </select>
                            </div>
                            <div className="input-group">
                                <label className="input-label">Restaurant Contact Phone Number</label>
                                <input
                                    className="input"
                                    value={formData.contact_phone}
                                    onChange={e => setFormData({ ...formData, contact_phone: e.target.value })}
                                    placeholder="e.g. +91 98765 43210"
                                />
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                                <div className="input-group">
                                    <label className="input-label">GSTIN (Optional)</label>
                                    <input
                                        className="input"
                                        value={formData.gstin}
                                        onChange={e => setFormData({ ...formData, gstin: e.target.value })}
                                        placeholder="e.g. 21AABCS1429B1Z1"
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">FSSAI License (Optional)</label>
                                    <input
                                        className="input"
                                        value={formData.fssai_license_number}
                                        onChange={e => setFormData({ ...formData, fssai_license_number: e.target.value })}
                                        placeholder="14-digit FSSAI #"
                                    />
                                </div>
                            </div>
                            <div className="input-group">
                                <label className="input-label">Max Allowed Branches</label>
                                <input
                                    type="number"
                                    className="input"
                                    required
                                    min="1"
                                    value={formData.max_branches}
                                    onChange={e => setFormData({ ...formData, max_branches: parseInt(e.target.value) })}
                                />
                            </div>
                            <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
                                <button type="submit" className="btn-primary" style={{ flex: 1 }}>{editTarget ? "Save Changes" : "Onboard"}</button>
                                <button type="button" className="btn-secondary" onClick={() => { setShowAdd(false); setEditTarget(null); }}>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--border)" }}>
                            <th style={{ padding: "16px", textAlign: "left" }}>Restaurant & UPI</th>
                            <th style={{ padding: "16px", textAlign: "left" }}>SaaS Plan & Expiry</th>
                            <th style={{ padding: "16px", textAlign: "center" }}>Branches</th>
                            <th style={{ padding: "16px", textAlign: "center" }}>Status</th>
                            <th style={{ padding: "16px", textAlign: "center" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {restaurants.map(r => (
                            <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "16px" }}>
                                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{r.whatsapp_display_number}</div>
                                    <div style={{ fontSize: "0.76rem", color: "var(--green)", marginTop: "4px" }}>
                                        🏦 UPI: {r.merchant_upi_id || "Default (.env)"}
                                    </div>
                                </td>
                                <td style={{ padding: "16px", fontSize: "0.82rem" }}>
                                    <div style={{ fontWeight: 700, color: "var(--accent)" }}>
                                        {r.subscription_plan || "STARTER"}
                                    </div>
                                    <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                                        {r.subscription_expires_at
                                            ? `Expires: ${new Date(r.subscription_expires_at).toLocaleDateString()}`
                                            : "No expiry set"}
                                    </div>
                                    {r.pending_renewal_plan && (
                                        <div style={{ marginTop: "6px", padding: "6px 10px", background: "rgba(255,159,67,0.15)", border: "1px solid var(--orange)", borderRadius: "8px" }}>
                                            <div style={{ color: "var(--orange)", fontWeight: 700, fontSize: "0.75rem" }}>
                                                🔔 Paid ₹{r.pending_renewal_amount} ({r.pending_renewal_plan})
                                            </div>
                                            <div style={{ fontSize: "0.72rem" }}>UTR: <strong>{r.pending_renewal_utr}</strong></div>
                                            <button
                                                className="btn btn-success btn-sm"
                                                style={{ marginTop: "4px", padding: "3px 8px", fontSize: "0.72rem" }}
                                                onClick={() => handleApproveRenewal(r, r.pending_renewal_plan === "ANNUAL_PRO" ? 365 : 30)}
                                            >
                                                ✅ Approve & Extend
                                            </button>
                                        </div>
                                    )}
                                </td>
                                <td style={{ padding: "16px", textAlign: "center" }}>
                                    <span style={{
                                        padding: "4px 12px",
                                        borderRadius: "20px",
                                        background: "rgba(84,160,255,0.1)",
                                        color: "var(--blue)",
                                        fontWeight: 600
                                    }}>
                                        {r.max_branches}
                                    </span>
                                </td>
                                <td style={{ padding: "16px", textAlign: "center" }}>
                                    <span className={r.is_active ? "badge-ready" : "badge-new"}>
                                        {r.is_active ? "ACTIVE" : "INACTIVE"}
                                    </span>
                                </td>
                                <td style={{ padding: "16px", textAlign: "center" }}>
                                    <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                                        <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: "0.8rem" }} onClick={() => openEdit(r)}>
                                            ✏️ Edit
                                        </button>
                                        <button
                                            className="btn-secondary"
                                            style={{ padding: "6px 10px", fontSize: "0.78rem", border: "1px solid var(--green)", color: "var(--green)" }}
                                            onClick={() => handleApproveRenewal(r, 30)}
                                        >
                                            +30d Plan
                                        </button>
                                        <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: "0.8rem", border: "1px solid var(--orange)", color: "var(--orange)" }} onClick={() => setResetTarget(r)}>
                                            🔑 Reset Pass
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
