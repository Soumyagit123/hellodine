import { useEffect, useState } from "react";
import api from "../../api/client";

export default function MenuAdmin() {
    const [categories, setCategories] = useState<any[]>([]);
    const [items, setItems] = useState<any[]>([]);
    const [selectedCat, setSelectedCat] = useState<string>("");
    const [branchId, setBranchId] = useState<string>("");
    const [showNewCat, setShowNewCat] = useState(false);
    const [showNewItem, setShowNewItem] = useState(false);
    const [catName, setCatName] = useState("");
    const [itemForm, setItemForm] = useState({ name: "", base_price: "", gst_percent: "5", is_veg: true, is_bestseller: false, description: "" });

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
        api.get(`/menu/categories?branch_id=${branchId}`).then((r) => setCategories(r.data));
    }, [branchId]);

    useEffect(() => {
        if (!selectedCat || !branchId) return;
        api.get(`/menu/items?branch_id=${branchId}&category_id=${selectedCat}`).then((r) => setItems(r.data));
    }, [selectedCat, branchId]);

    async function createCategory() {
        await api.post("/menu/categories", { branch_id: branchId, name: catName, sort_order: categories.length });
        setCatName(""); setShowNewCat(false);
        const r = await api.get(`/menu/categories?branch_id=${branchId}`);
        setCategories(r.data);
    }

    async function createItem() {
        await api.post("/menu/items", { ...itemForm, branch_id: branchId, category_id: selectedCat, base_price: parseFloat(itemForm.base_price), gst_percent: parseInt(itemForm.gst_percent) });
        setShowNewItem(false);
        setItemForm({ name: "", base_price: "", gst_percent: "5", is_veg: true, is_bestseller: false, description: "" });
        const r = await api.get(`/menu/items?branch_id=${branchId}&category_id=${selectedCat}`);
        setItems(r.data);
    }

    async function toggleBestseller(item: any) {
        await api.patch(`/menu/items/${item.id}`, { is_bestseller: !item.is_bestseller });
        const r = await api.get(`/menu/items?branch_id=${branchId}&category_id=${selectedCat}`);
        setItems(r.data);
    }

    async function toggleAvailability(item: any) {
        await api.patch(`/menu/items/${item.id}`, { is_available: !item.is_available });
        const r = await api.get(`/menu/items?branch_id=${branchId}&category_id=${selectedCat}`);
        setItems(r.data);
    }

    return (
        <div>
            <div className="page-header">
                <div><h1 className="page-title">Menu Management</h1></div>
                <button className="btn btn-primary btn-sm" onClick={() => setShowNewCat(true)}>+ Category</button>
            </div>

            <div style={{ display: "flex", gap: 24 }}>
                {/* Categories sidebar */}
                <div style={{ width: 200, flexShrink: 0 }}>
                    <p className="text-muted text-sm" style={{ marginBottom: 8 }}>CATEGORIES</p>
                    {categories.map((c) => (
                        <button key={c.id} className={`nav-link${selectedCat === c.id ? " active" : ""}`} onClick={() => setSelectedCat(c.id)}>
                            {c.name}
                        </button>
                    ))}
                </div>

                {/* Items table */}
                <div style={{ flex: 1 }}>
                    {selectedCat ? (
                        <>
                            <div className="flex justify-between mb-3">
                                <span className="text-muted text-sm">{items.length} items</span>
                                <button className="btn btn-primary btn-sm" onClick={() => setShowNewItem(true)}>+ Add Item</button>
                            </div>
                            <div className="card table-wrap">
                                <table>
                                    <thead><tr><th>Name</th><th>Type</th><th>Price</th><th>GST</th><th>⭐ Bestseller</th><th>Available</th><th></th></tr></thead>
                                    <tbody>
                                        {items.map((item) => (
                                            <tr key={item.id}>
                                                <td>
                                                    <span style={{ fontWeight: 600 }}>{item.name}</span>
                                                    {item.is_bestseller && (
                                                        <span className="badge" style={{ marginLeft: 8, background: "rgba(249,202,36,0.2)", color: "#f9ca24" }}>
                                                            ⭐ Top Pick
                                                        </span>
                                                    )}
                                                </td>
                                                <td>{item.is_veg ? <span className="badge badge-veg">🟢 Veg</span> : <span className="badge badge-nonveg">🔴 Non-Veg</span>}</td>
                                                <td>₹{item.base_price}</td>
                                                <td>{item.gst_percent}%</td>
                                                <td>
                                                    <button
                                                        className={`btn btn-sm ${item.is_bestseller ? "btn-primary" : "btn-outline"}`}
                                                        style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                                                        onClick={() => toggleBestseller(item)}
                                                    >
                                                        {item.is_bestseller ? "⭐ Bestseller" : "☆ Mark Best"}
                                                    </button>
                                                </td>
                                                <td>
                                                    <span style={{ color: item.is_available ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                                                        {item.is_available ? "Yes" : "No"}
                                                    </span>
                                                </td>
                                                <td>
                                                    <button className="btn btn-outline btn-sm" onClick={() => toggleAvailability(item)}>
                                                        {item.is_available ? "Disable" : "Enable"}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : <p className="text-muted">← Select a category</p>}
                </div>
            </div>

            {/* New Category Modal */}
            {showNewCat && (
                <div className="modal-overlay" onClick={() => setShowNewCat(false)}>
                    <div className="card modal" onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 20 }}>New Category</h2>
                        <div className="input-group"><label className="input-label">Name</label><input className="input" value={catName} onChange={(e) => setCatName(e.target.value)} /></div>
                        <div className="flex gap-2"><button className="btn btn-outline" onClick={() => setShowNewCat(false)}>Cancel</button><button className="btn btn-primary" onClick={createCategory}>Create</button></div>
                    </div>
                </div>
            )}

            {/* New Item Modal */}
            {showNewItem && (
                <div className="modal-overlay" onClick={() => setShowNewItem(false)}>
                    <div className="card modal" onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 20 }}>New Menu Item</h2>
                        <div className="input-group"><label className="input-label">Name</label><input className="input" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} /></div>
                        <div className="input-group"><label className="input-label">Description</label><input className="input" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} /></div>
                        <div className="input-group"><label className="input-label">Base Price (₹)</label><input className="input" type="number" value={itemForm.base_price} onChange={(e) => setItemForm({ ...itemForm, base_price: e.target.value })} /></div>
                        <div className="input-group">
                            <label className="input-label">GST %</label>
                            <select className="select" style={{ width: "100%" }} value={itemForm.gst_percent} onChange={(e) => setItemForm({ ...itemForm, gst_percent: e.target.value })}>
                                <option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option>
                            </select>
                        </div>
                        <div className="input-group">
                            <label className="input-label">Type</label>
                            <select className="select" style={{ width: "100%" }} value={itemForm.is_veg ? "veg" : "nonveg"} onChange={(e) => setItemForm({ ...itemForm, is_veg: e.target.value === "veg" })}>
                                <option value="veg">🟢 Veg</option><option value="nonveg">🔴 Non-Veg</option>
                            </select>
                        </div>
                        <div className="input-group">
                            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.9rem" }}>
                                <input
                                    type="checkbox"
                                    checked={itemForm.is_bestseller}
                                    onChange={(e) => setItemForm({ ...itemForm, is_bestseller: e.target.checked })}
                                />
                                ⭐ Mark as Chef's Bestseller (Recommended by AI to confused customers)
                            </label>
                        </div>
                        <div className="flex gap-2">
                            <button className="btn btn-outline" onClick={() => setShowNewItem(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={createItem}>Add Item</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
