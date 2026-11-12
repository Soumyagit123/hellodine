import { useEffect, useState } from "react";
import api from "../../api/client";

const ROLES = ["KITCHEN", "CASHIER", "BRANCH_ADMIN", "SUPER_ADMIN"];

export default function StaffAdmin() {
    const [staff, setStaff] = useState<any[]>([]);
    const [restaurantId, setRestaurantId] = useState<string>("");
    const [branchId, setBranchId] = useState<string>("");
    const [userRole, setUserRole] = useState<string>("");
    const [showNew, setShowNew] = useState(false);
    const [editingStaff, setEditingStaff] = useState<any | null>(null);

    const [form, setForm] = useState({
        name: "",
        phone: "",
        password: "",
        role: "KITCHEN",
        branch_id: "",
        is_active: true,
    });
    const [loading, setLoading] = useState(false);
    const [branches, setBranches] = useState<any[]>([]);

    useEffect(() => {
        let rId = "";
        const token = localStorage.getItem("hd_token");
        if (token) {
            try {
                const payload = JSON.parse(atob(token.split(".")[1]));
                rId = payload.restaurant_id || "";
                setRestaurantId(rId);
                const role = payload.role || "";
                setUserRole(role);
            } catch { }
        }
        const s = JSON.parse(localStorage.getItem("hd_staff") || "{}");
        const selectedBranchId = localStorage.getItem("hd_selected_branch");

        if (s.branch_id) {
            setBranchId(s.branch_id);
            setForm((f) => ({ ...f, branch_id: s.branch_id }));
        } else if (selectedBranchId) {
            setBranchId(selectedBranchId);
            setForm((f) => ({ ...f, branch_id: selectedBranchId }));
        }

        if (rId || s.restaurant_id) {
            const rid = rId || s.restaurant_id;
            api.get(`/admin/branches?restaurant_id=${rid}`).then((r) => {
                setBranches(r.data);
                if (!branchId && !selectedBranchId && r.data.length > 0) {
                    setBranchId(r.data[0].id);
                    setForm((f) => ({ ...f, branch_id: r.data[0].id }));
                }
            });
        }
    }, []);

    useEffect(() => {
        if (!restaurantId || !branchId) return;
        reloadStaff();
    }, [restaurantId, branchId]);

    async function reloadStaff() {
        const r = await api.get(`/admin/staff?restaurant_id=${restaurantId}&branch_id=${branchId}`);
        setStaff(r.data);
    }

    async function createStaff() {
        if (!form.name.trim() || !form.phone.trim()) {
            alert("Please provide staff name and login ID / mobile.");
            return;
        }
        if (!form.branch_id) {
            alert("Please select a branch");
            return;
        }
        setLoading(true);
        try {
            await api.post("/admin/staff", { ...form, restaurant_id: restaurantId });
            setShowNew(false);
            setForm({ name: "", phone: "", password: "", role: "KITCHEN", branch_id: branchId, is_active: true });
            await reloadStaff();
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to create staff");
        } finally {
            setLoading(false);
        }
    }

    async function updateStaff() {
        if (!editingStaff || !form.name.trim() || !form.phone.trim()) return;
        setLoading(true);
        try {
            const payload: any = {
                name: form.name.trim(),
                phone: form.phone.trim(),
                role: form.role,
                branch_id: form.branch_id,
                is_active: form.is_active,
            };
            if (form.password.trim()) {
                payload.password = form.password.trim();
            }
            await api.patch(`/admin/staff/${editingStaff.id}`, payload);
            setEditingStaff(null);
            await reloadStaff();
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to update staff");
        } finally {
            setLoading(false);
        }
    }

    async function deleteStaff(member: any) {
        if (!window.confirm(`Are you sure you want to deactivate and remove staff member "${member.name}"?`)) return;
        try {
            await api.delete(`/admin/staff/${member.id}`);
            await reloadStaff();
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to delete staff member");
        }
    }

    async function toggleActive(member: any) {
        try {
            await api.patch(`/admin/staff/${member.id}`, { is_active: !member.is_active });
            await reloadStaff();
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to update staff status");
        }
    }

    const roleColor: Record<string, string> = {
        SUPER_ADMIN: "var(--accent)",
        BRANCH_ADMIN: "var(--blue)",
        KITCHEN: "var(--orange)",
        CASHIER: "var(--green)",
    };

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Staff Management</h1>
                    <p className="page-sub">{staff.length} staff members configured</p>
                </div>
                <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                        setForm({ name: "", phone: "", password: "", role: "KITCHEN", branch_id: branchId, is_active: true });
                        setShowNew(true);
                    }}
                >
                    + Add New Staff
                </button>
            </div>

            <div className="card table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Branch</th>
                            <th>Login ID / Mobile</th>
                            <th>Role</th>
                            <th>Status</th>
                            <th style={{ textAlign: "right" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {staff.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="text-muted text-center" style={{ padding: 24 }}>
                                    No staff found for this branch. Click "+ Add New Staff" above!
                                </td>
                            </tr>
                        ) : (
                            staff.map((s) => (
                                <tr key={s.id}>
                                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                                    <td className="text-sm">{s.branch_name || "Assigned Branch"}</td>
                                    <td className="text-muted">{s.phone}</td>
                                    <td>
                                        <span
                                            className="badge"
                                            style={{
                                                background: `${roleColor[s.role] || "var(--accent)"}22`,
                                                color: roleColor[s.role] || "var(--accent)",
                                            }}
                                        >
                                            {s.role}
                                        </span>
                                    </td>
                                    <td>
                                        <span style={{ color: s.is_active ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                                            {s.is_active ? "● Active" : "○ Inactive"}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="flex gap-2 justify-end">
                                            <button
                                                className="btn btn-outline btn-sm"
                                                style={{ padding: "4px 8px", fontSize: "0.78rem" }}
                                                onClick={() => toggleActive(s)}
                                            >
                                                {s.is_active ? "Deactivate" : "Activate"}
                                            </button>
                                            <button
                                                className="btn btn-outline btn-sm"
                                                style={{ padding: "4px 8px", fontSize: "0.78rem" }}
                                                title="Edit Staff"
                                                onClick={() => {
                                                    setEditingStaff(s);
                                                    setForm({
                                                        name: s.name,
                                                        phone: s.phone,
                                                        password: "",
                                                        role: s.role,
                                                        branch_id: s.branch_id || branchId,
                                                        is_active: s.is_active,
                                                    });
                                                }}
                                            >
                                                ✏️ Edit
                                            </button>
                                            <button
                                                className="btn btn-outline btn-sm"
                                                style={{ padding: "4px 8px", fontSize: "0.78rem", borderColor: "var(--red)", color: "var(--red)" }}
                                                title="Delete Staff"
                                                onClick={() => deleteStaff(s)}
                                            >
                                                🗑️ Delete
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create Staff Modal */}
            {showNew && (
                <div className="modal-overlay" onClick={() => setShowNew(false)}>
                    <div className="card modal" onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 20 }}>+ New Staff Member</h2>
                        <div className="input-group">
                            <label className="input-label">Full Name</label>
                            <input
                                className="input"
                                placeholder="e.g. Ramesh Kumar"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                autoFocus
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Login ID (10-Digit Mobile or Custom Username)</label>
                            <input
                                className="input"
                                placeholder="e.g. 9876543210 or ramesh_cashier"
                                value={form.phone}
                                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Password / PIN</label>
                            <input
                                className="input"
                                type="password"
                                placeholder="Enter secure password"
                                value={form.password}
                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Role</label>
                            <select
                                className="select"
                                style={{ width: "100%" }}
                                value={form.role}
                                onChange={(e) => setForm({ ...form, role: e.target.value })}
                            >
                                {ROLES.filter((r) => {
                                    if (userRole === "BRANCH_ADMIN") {
                                        return r === "KITCHEN" || r === "CASHIER";
                                    }
                                    return true;
                                }).map((r) => (
                                    <option key={r} value={r}>
                                        {r}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {userRole === "SUPER_ADMIN" && (
                            <div className="input-group">
                                <label className="input-label">Assign to Branch</label>
                                <select
                                    className="select"
                                    style={{ width: "100%" }}
                                    value={form.branch_id}
                                    onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                                >
                                    <option value="">Select Branch</option>
                                    {branches.map((b) => (
                                        <option key={b.id} value={b.id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="flex gap-2 justify-end" style={{ marginTop: 20 }}>
                            <button className="btn btn-outline" onClick={() => setShowNew(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={createStaff} disabled={loading}>
                                {loading ? "Creating…" : "Create Staff"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Staff Modal */}
            {editingStaff && (
                <div className="modal-overlay" onClick={() => setEditingStaff(null)}>
                    <div className="card modal" onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 20 }}>✏️ Edit Staff: {editingStaff.name}</h2>
                        <div className="input-group">
                            <label className="input-label">Full Name</label>
                            <input
                                className="input"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                autoFocus
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Login ID / Mobile</label>
                            <input
                                className="input"
                                value={form.phone}
                                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">New Password (leave blank to keep existing)</label>
                            <input
                                className="input"
                                type="password"
                                placeholder="Optional new password"
                                value={form.password}
                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Role</label>
                            <select
                                className="select"
                                style={{ width: "100%" }}
                                value={form.role}
                                onChange={(e) => setForm({ ...form, role: e.target.value })}
                            >
                                {ROLES.filter((r) => {
                                    if (userRole === "BRANCH_ADMIN") {
                                        return r === "KITCHEN" || r === "CASHIER";
                                    }
                                    return true;
                                }).map((r) => (
                                    <option key={r} value={r}>
                                        {r}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {userRole === "SUPER_ADMIN" && (
                            <div className="input-group">
                                <label className="input-label">Assigned Branch</label>
                                <select
                                    className="select"
                                    style={{ width: "100%" }}
                                    value={form.branch_id}
                                    onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                                >
                                    {branches.map((b) => (
                                        <option key={b.id} value={b.id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="flex gap-2 justify-end" style={{ marginTop: 20 }}>
                            <button className="btn btn-outline" onClick={() => setEditingStaff(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={updateStaff} disabled={loading}>
                                {loading ? "Saving…" : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
