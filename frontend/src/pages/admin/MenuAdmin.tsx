import { useEffect, useState } from "react";
import api from "../../api/client";
import MenuImportModal from "../../components/MenuImportModal";

export default function MenuAdmin() {
    const [categories, setCategories] = useState<any[]>([]);
    const [items, setItems] = useState<any[]>([]);
    const [selectedCat, setSelectedCat] = useState<string>("");
    const [branchId, setBranchId] = useState<string>("");

    // Category Modals
    const [showNewCat, setShowNewCat] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState<any | null>(null);
    const [catName, setCatName] = useState("");

    // Item Modals
    const [showNewItem, setShowNewItem] = useState(false);
    const [editingItem, setEditingItem] = useState<any | null>(null);
    const [itemForm, setItemForm] = useState({
        name: "",
        base_price: "",
        gst_percent: "5",
        is_veg: true,
        is_bestseller: false,
        description: "",
        category_id: "",
    });

    useEffect(() => {
        const staff = JSON.parse(localStorage.getItem("hd_staff") || "{}");
        const selectedBranchId = localStorage.getItem("hd_selected_branch");

        if (staff.branch_id) {
            setBranchId(staff.branch_id);
        } else if (selectedBranchId) {
            setBranchId(selectedBranchId);
        } else {
            const token = localStorage.getItem("hd_token");
            if (token) {
                try {
                    const payload = JSON.parse(atob(token.split(".")[1]));
                    if (payload.restaurant_id) {
                        api.get(`/admin/branches?restaurant_id=${payload.restaurant_id}`).then((r) => {
                            if (r.data.length > 0) setBranchId(r.data[0].id);
                        });
                    }
                } catch { }
            }
        }
    }, []);

    useEffect(() => {
        if (!branchId) return;
        api.get(`/menu/categories?branch_id=${branchId}`).then((r) => {
            setCategories(r.data);
            if (r.data.length > 0 && !selectedCat) {
                setSelectedCat(r.data[0].id);
            }
        });
    }, [branchId]);

    useEffect(() => {
        if (!selectedCat || !branchId) return;
        api.get(`/menu/items?branch_id=${branchId}&category_id=${selectedCat}`).then((r) => setItems(r.data));
    }, [selectedCat, branchId]);

    async function reloadCategories() {
        const r = await api.get(`/menu/categories?branch_id=${branchId}`);
        setCategories(r.data);
    }

    async function reloadItems() {
        const r = await api.get(`/menu/items?branch_id=${branchId}&category_id=${selectedCat}`);
        setItems(r.data);
    }

    const [submitting, setSubmitting] = useState(false);

    // ── Category Actions ────────────────────────────────────────────────────────
    async function createCategory() {
        if (!catName.trim() || submitting) return;
        setSubmitting(true);
        try {
            await api.post("/menu/categories", { branch_id: branchId, name: catName.trim(), sort_order: categories.length });
            setCatName("");
            setShowNewCat(false);
            await reloadCategories();
        } finally {
            setSubmitting(false);
        }
    }

    async function updateCategory() {
        if (!editingCategory || !catName.trim() || submitting) return;
        setSubmitting(true);
        try {
            await api.patch(`/menu/categories/${editingCategory.id}`, { name: catName.trim() });
            setEditingCategory(null);
            setCatName("");
            await reloadCategories();
        } finally {
            setSubmitting(false);
        }
    }

    async function deleteCategory(cat: any) {
        if (submitting || !window.confirm(`Are you sure you want to delete category "${cat.name}"?`)) return;
        setSubmitting(true);
        try {
            await api.delete(`/menu/categories/${cat.id}`);
            if (selectedCat === cat.id) {
                setSelectedCat("");
                setItems([]);
            }
            await reloadCategories();
        } finally {
            setSubmitting(false);
        }
    }

    // ── Item Actions ────────────────────────────────────────────────────────────
    async function createItem() {
        if (!itemForm.name.trim() || !itemForm.base_price || submitting) return;
        setSubmitting(true);
        try {
            await api.post("/menu/items", {
                ...itemForm,
                branch_id: branchId,
                category_id: selectedCat,
                base_price: parseFloat(itemForm.base_price),
                gst_percent: parseInt(itemForm.gst_percent),
            });
            setShowNewItem(false);
            setItemForm({ name: "", base_price: "", gst_percent: "5", is_veg: true, is_bestseller: false, description: "", category_id: "" });
            await reloadItems();
        } finally {
            setSubmitting(false);
        }
    }

    async function updateItem() {
        if (!editingItem || !itemForm.name.trim() || !itemForm.base_price || submitting) return;
        setSubmitting(true);
        try {
            await api.patch(`/menu/items/${editingItem.id}`, {
                name: itemForm.name.trim(),
                description: itemForm.description.trim(),
                base_price: parseFloat(itemForm.base_price),
                gst_percent: parseInt(itemForm.gst_percent),
                is_veg: itemForm.is_veg,
                is_bestseller: itemForm.is_bestseller,
                category_id: itemForm.category_id || selectedCat,
            });
            setEditingItem(null);
            await reloadItems();
        } finally {
            setSubmitting(false);
        }
    }

    async function deleteItem(item: any) {
        if (submitting || !window.confirm(`Are you sure you want to delete "${item.name}" from the menu?`)) return;
        setSubmitting(true);
        try {
            await api.delete(`/menu/items/${item.id}`);
            await reloadItems();
        } finally {
            setSubmitting(false);
        }
    }

    async function toggleBestseller(item: any) {
        if (submitting) return;
        setSubmitting(true);
        try {
            await api.patch(`/menu/items/${item.id}`, { is_bestseller: !item.is_bestseller });
            await reloadItems();
        } finally {
            setSubmitting(false);
        }
    }

    async function toggleAvailability(item: any) {
        if (submitting) return;
        setSubmitting(true);
        try {
            await api.patch(`/menu/items/${item.id}`, { is_available: !item.is_available });
            await reloadItems();
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Menu Management</h1>
                    <p className="page-sub">Manage food categories, items, prices, and chef bestsellers</p>
                </div>
                <div className="flex gap-2">
                    <button className="btn btn-sm" onClick={() => setShowImportModal(true)}>
                        🤖 AI Import Menu
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => { setCatName(""); setShowNewCat(true); }}>
                        + New Category
                    </button>
                </div>
            </div>

            <div style={{ display: "flex", gap: 24, alignItems: "stretch", height: "calc(100vh - 170px)" }}>
                {/* Categories sidebar */}
                <div
                    className="card"
                    style={{
                        width: 280,
                        flexShrink: 0,
                        padding: "16px 14px",
                        background: "#161a2d",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 16,
                        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                    }}
                >
                    <div className="flex justify-between items-center" style={{ marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid rgba(255, 255, 255, 0.08)", flexShrink: 0 }}>
                        <span className="text-muted text-xs font-bold" style={{ letterSpacing: "0.08em" }}>CATEGORIES</span>
                        <span className="badge" style={{ background: "rgba(99, 102, 241, 0.18)", color: "#818cf8" }}>{categories.length}</span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", paddingRight: 4, flex: 1 }}>
                        {categories.map((c) => (
                            <div
                                key={c.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    background: selectedCat === c.id ? "rgba(99, 102, 241, 0.15)" : "rgba(255, 255, 255, 0.02)",
                                    border: selectedCat === c.id ? "1px solid #6366f1" : "1px solid rgba(255, 255, 255, 0.04)",
                                    borderRadius: 10,
                                    padding: "8px 12px",
                                    transition: "all 0.15s ease-in-out",
                                }}
                            >
                                <button
                                    className="nav-link"
                                    style={{
                                        border: "none",
                                        background: "transparent",
                                        textAlign: "left",
                                        flex: 1,
                                        fontWeight: selectedCat === c.id ? 700 : 500,
                                        fontSize: "0.9rem",
                                        color: selectedCat === c.id ? "#818cf8" : "#e2e8f0",
                                        cursor: "pointer",
                                        padding: 0,
                                    }}
                                    onClick={() => setSelectedCat(c.id)}
                                >
                                    {c.name}
                                </button>
                                <div className="flex gap-1" style={{ opacity: selectedCat === c.id ? 1 : 0.65 }}>
                                    <button
                                        type="button"
                                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.85rem", padding: "2px 4px" }}
                                        title="Edit Category Name"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingCategory(c);
                                            setCatName(c.name);
                                        }}
                                    >
                                        ✏️
                                    </button>
                                    <button
                                        type="button"
                                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.85rem", padding: "2px 4px", color: "var(--red)" }}
                                        title="Delete Category"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            deleteCategory(c);
                                        }}
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Items table */}
                <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", height: "100%" }}>
                    {selectedCat ? (
                        <>
                            <div className="flex justify-between items-center mb-3" style={{ flexShrink: 0 }}>
                                <span className="text-muted text-sm font-bold">
                                    {categories.find((c) => c.id === selectedCat)?.name || "Dishes"} ({items.length} items)
                                </span>
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => {
                                        setItemForm({
                                            name: "",
                                            base_price: "",
                                            gst_percent: "5",
                                            is_veg: true,
                                            is_bestseller: false,
                                            description: "",
                                            category_id: selectedCat,
                                        });
                                        setShowNewItem(true);
                                    }}
                                >
                                    + Add Food Item
                                </button>
                            </div>
                            <div
                                className="card"
                                style={{
                                    background: "#161a2d",
                                    border: "1px solid rgba(255, 255, 255, 0.08)",
                                    borderRadius: 16,
                                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
                                    flex: 1,
                                    padding: 0,
                                    overflow: "hidden",
                                    display: "flex",
                                    flexDirection: "column",
                                }}
                            >
                                <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                                        <thead>
                                            <tr>
                                                <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#161a2d", borderBottom: "1px solid rgba(255, 255, 255, 0.12)" }}>Dish Name</th>
                                                <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#161a2d", borderBottom: "1px solid rgba(255, 255, 255, 0.12)" }}>Type</th>
                                                <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#161a2d", borderBottom: "1px solid rgba(255, 255, 255, 0.12)" }}>Price</th>
                                                <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#161a2d", borderBottom: "1px solid rgba(255, 255, 255, 0.12)" }}>GST</th>
                                                <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#161a2d", borderBottom: "1px solid rgba(255, 255, 255, 0.12)" }}>⭐ Bestseller</th>
                                                <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#161a2d", borderBottom: "1px solid rgba(255, 255, 255, 0.12)" }}>Status</th>
                                                <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#161a2d", borderBottom: "1px solid rgba(255, 255, 255, 0.12)", textAlign: "right" }}>Actions</th>
                                            </tr>
                                        </thead>
                                    <tbody>
                                        {items.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="text-muted text-center" style={{ padding: 24 }}>
                                                    No dishes in this category yet. Click "+ Add Food Item" above!
                                                </td>
                                            </tr>
                                        ) : (
                                            items.map((item) => (
                                                <tr key={item.id}>
                                                    <td>
                                                        <div style={{ fontWeight: 600 }}>{item.name}</div>
                                                        {item.description && (
                                                            <div className="text-muted text-sm" style={{ fontSize: "0.78rem" }}>
                                                                {item.description}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {item.is_veg ? (
                                                            <span className="badge badge-veg">🟢 Veg</span>
                                                        ) : (
                                                            <span className="badge badge-nonveg">🔴 Non-Veg</span>
                                                        )}
                                                    </td>
                                                    <td>₹{Number(item.base_price).toFixed(2)}</td>
                                                    <td>{item.gst_percent}%</td>
                                                    <td>
                                                        <button
                                                            className={`btn btn-sm ${item.is_bestseller ? "btn-primary" : "btn-outline"}`}
                                                            style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                                                            onClick={() => toggleBestseller(item)}
                                                            title="Toggle Chef Recommendation"
                                                        >
                                                            {item.is_bestseller ? "⭐ Bestseller" : "☆ Mark Best"}
                                                        </button>
                                                    </td>
                                                    <td>
                                                        <span style={{ color: item.is_available ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                                                            {item.is_available ? "Available" : "Disabled"}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div className="flex gap-2 justify-end">
                                                            <button
                                                                className="btn btn-outline btn-sm"
                                                                style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                                                                onClick={() => toggleAvailability(item)}
                                                            >
                                                                {item.is_available ? "Disable" : "Enable"}
                                                            </button>
                                                            <button
                                                                className="btn btn-outline btn-sm"
                                                                style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                                                                title="Edit Dish"
                                                                onClick={() => {
                                                                    setEditingItem(item);
                                                                    setItemForm({
                                                                        name: item.name,
                                                                        base_price: String(item.base_price),
                                                                        gst_percent: String(item.gst_percent || 5),
                                                                        is_veg: item.is_veg,
                                                                        is_bestseller: item.is_bestseller,
                                                                        description: item.description || "",
                                                                        category_id: item.category_id || selectedCat,
                                                                    });
                                                                }}
                                                            >
                                                                ✏️ Edit
                                                            </button>
                                                            <button
                                                                className="btn btn-outline btn-sm"
                                                                style={{ padding: "4px 8px", fontSize: "0.75rem", borderColor: "var(--red)", color: "var(--red)" }}
                                                                title="Delete Dish"
                                                                onClick={() => deleteItem(item)}
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
                            </div>
                        </>
                    ) : (
                        <p className="text-muted">← Select a category to view dishes</p>
                    )}
                </div>
            </div>

            {/* New Category Modal */}
            {showNewCat && (
                <div className="modal-overlay" onClick={() => setShowNewCat(false)}>
                    <div className="card modal" onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 20 }}>+ New Menu Category</h2>
                        <div className="input-group">
                            <label className="input-label">Category Name</label>
                            <input
                                className="input"
                                placeholder="e.g. Starters, Tandoor, Main Course, Desserts"
                                value={catName}
                                onChange={(e) => setCatName(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button className="btn btn-outline" onClick={() => setShowNewCat(false)} disabled={submitting}>Cancel</button>
                            <button className="btn btn-primary" onClick={createCategory} disabled={submitting}>
                                {submitting ? "Creating…" : "Create Category"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Category Modal */}
            {editingCategory && (
                <div className="modal-overlay" onClick={() => !submitting && setEditingCategory(null)}>
                    <div className="card modal" onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 20 }}>✏️ Edit Category Name</h2>
                        <div className="input-group">
                            <label className="input-label">Category Name</label>
                            <input
                                className="input"
                                value={catName}
                                onChange={(e) => setCatName(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button className="btn btn-outline" onClick={() => setEditingCategory(null)} disabled={submitting}>Cancel</button>
                            <button className="btn btn-primary" onClick={updateCategory} disabled={submitting}>
                                {submitting ? "Saving…" : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* New / Edit Item Modal */}
            {(showNewItem || editingItem) && (
                <div className="modal-overlay" onClick={() => { if (!submitting) { setShowNewItem(false); setEditingItem(null); } }}>
                    <div className="card modal" onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 20 }}>
                            {editingItem ? `✏️ Edit: ${editingItem.name}` : "+ Add New Menu Item"}
                        </h2>
                        <div className="input-group">
                            <label className="input-label">Dish Name</label>
                            <input
                                className="input"
                                placeholder="e.g. Paneer Butter Masala, Butter Naan"
                                value={itemForm.name}
                                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                                autoFocus
                            />
                        </div>
                        <div className="input-group">
                            <label className="input-label">Description / Preparation Info</label>
                            <input
                                className="input"
                                placeholder="e.g. Rich cashew gravy with cottage cheese cubes"
                                value={itemForm.description}
                                onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="input-group">
                                <label className="input-label">Base Price (₹)</label>
                                <input
                                    className="input"
                                    type="number"
                                    placeholder="250"
                                    value={itemForm.base_price}
                                    onChange={(e) => setItemForm({ ...itemForm, base_price: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">GST %</label>
                                <select
                                    className="select"
                                    style={{ width: "100%" }}
                                    value={itemForm.gst_percent}
                                    onChange={(e) => setItemForm({ ...itemForm, gst_percent: e.target.value })}
                                >
                                    <option value="0">0%</option>
                                    <option value="5">5% (Restaurant Standard)</option>
                                    <option value="12">12%</option>
                                    <option value="18">18%</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="input-group">
                                <label className="input-label">Food Type</label>
                                <select
                                    className="select"
                                    style={{ width: "100%" }}
                                    value={itemForm.is_veg ? "veg" : "nonveg"}
                                    onChange={(e) => setItemForm({ ...itemForm, is_veg: e.target.value === "veg" })}
                                >
                                    <option value="veg">🟢 Pure Veg</option>
                                    <option value="nonveg">🔴 Non-Veg</option>
                                </select>
                            </div>
                            <div className="input-group">
                                <label className="input-label">Category</label>
                                <select
                                    className="select"
                                    style={{ width: "100%" }}
                                    value={itemForm.category_id || selectedCat}
                                    onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })}
                                >
                                    {categories.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="input-group" style={{ marginTop: 8 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.9rem" }}>
                                <input
                                    type="checkbox"
                                    checked={itemForm.is_bestseller}
                                    onChange={(e) => setItemForm({ ...itemForm, is_bestseller: e.target.checked })}
                                />
                                ⭐ Mark as Chef's Bestseller (Recommended by AI Bot to customers)
                            </label>
                        </div>

                        <div className="flex gap-2 justify-end" style={{ marginTop: 16 }}>
                            <button
                                className="btn btn-outline"
                                onClick={() => { setShowNewItem(false); setEditingItem(null); }}
                                disabled={submitting}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={editingItem ? updateItem : createItem}
                                disabled={submitting}
                            >
                                {submitting ? "Saving…" : editingItem ? "Save Dish Changes" : "Add Food Item"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showImportModal && branchId && (
                <MenuImportModal
                    branchId={branchId}
                    onClose={() => setShowImportModal(false)}
                    onSuccess={async () => {
                        await reloadCategories();
                        if (selectedCat) await reloadItems();
                    }}
                />
            )}
        </div>
    );
}
