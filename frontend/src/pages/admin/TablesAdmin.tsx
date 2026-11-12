import { useEffect, useState } from "react";
import api from "../../api/client";
import { QRCodeCanvas } from "qrcode.react";

export default function TablesAdmin() {
    const [tables, setTables] = useState<any[]>([]);
    const [branchId, setBranchId] = useState<string>("");
    const [newNum, setNewNum] = useState("");
    const [showAdd, setShowAdd] = useState(false);
    const [editingTable, setEditingTable] = useState<any | null>(null);
    const [editNum, setEditNum] = useState("");

    const [qrResult, setQrResult] = useState<{
        table_number: number;
        wa_link: string;
        kiosk_path?: string;
        token?: string;
    } | null>(null);

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
    }, [showAdd]);

    useEffect(() => {
        if (!branchId) return;
        reloadTables();
    }, [branchId]);

    async function reloadTables() {
        const r = await api.get(`/admin/tables?branch_id=${branchId}`);
        setTables(r.data);
    }

    async function addTable() {
        if (!newNum) {
            alert("Please enter a table number");
            return;
        }
        if (!branchId) {
            alert("No branch selected. Please select a branch from the sidebar.");
            return;
        }
        try {
            await api.post("/admin/tables", { branch_id: branchId, table_number: parseInt(newNum) });
            setNewNum("");
            setShowAdd(false);
            await reloadTables();
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to add table");
        }
    }

    async function updateTableNumber() {
        if (!editingTable || !editNum) return;
        try {
            await api.patch(`/admin/tables/${editingTable.id}`, { table_number: parseInt(editNum) });
            setEditingTable(null);
            setEditNum("");
            await reloadTables();
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to update table");
        }
    }

    async function toggleTableStatus(table: any) {
        try {
            await api.patch(`/admin/tables/${table.id}`, { is_active: !table.is_active });
            await reloadTables();
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to update table status");
        }
    }

    async function deleteTable(table: any) {
        if (!window.confirm(`Are you sure you want to delete Table T${table.table_number}?`)) return;
        try {
            await api.delete(`/admin/tables/${table.id}`);
            await reloadTables();
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to delete table");
        }
    }

    async function generateQR(tableId: string) {
        const r = await api.post(`/admin/tables/${tableId}/qr`);
        setQrResult(r.data);
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Table Management</h1>
                    <p className="page-sub">{tables.length} tables configured for this branch</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                    + Add New Table
                </button>
            </div>

            <div className="card table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Table #</th>
                            <th>Status</th>
                            <th>Smart Tablet Kiosk & QR</th>
                            <th style={{ textAlign: "right" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tables.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="text-muted text-center" style={{ padding: 24 }}>
                                    No tables configured yet. Click "+ Add New Table" above!
                                </td>
                            </tr>
                        ) : (
                            tables.map((t) => (
                                <tr key={t.id}>
                                    <td style={{ fontWeight: 800, fontSize: "1.15rem", color: "var(--accent)" }}>
                                        🪑 Table T{t.table_number}
                                    </td>
                                    <td>
                                        <span style={{ color: t.is_active ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                                            {t.is_active ? "● Active" : "○ Inactive"}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="flex gap-2">
                                            <a
                                                className="btn btn-primary btn-sm"
                                                href={`/kiosk?table_id=${t.id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{ textDecoration: "none" }}
                                            >
                                                📱 Launch Tablet UI
                                            </a>
                                            <button className="btn btn-outline btn-sm" onClick={() => generateQR(t.id)}>
                                                🔗 Generate QR
                                            </button>
                                        </div>
                                    </td>
                                    <td>
                                        <div className="flex gap-2 justify-end">
                                            <button
                                                className="btn btn-outline btn-sm"
                                                style={{ padding: "4px 8px", fontSize: "0.78rem" }}
                                                onClick={() => toggleTableStatus(t)}
                                            >
                                                {t.is_active ? "Deactivate" : "Activate"}
                                            </button>
                                            <button
                                                className="btn btn-outline btn-sm"
                                                style={{ padding: "4px 8px", fontSize: "0.78rem" }}
                                                title="Edit Table Number"
                                                onClick={() => {
                                                    setEditingTable(t);
                                                    setEditNum(String(t.table_number));
                                                }}
                                            >
                                                ✏️ Edit
                                            </button>
                                            <button
                                                className="btn btn-outline btn-sm"
                                                style={{ padding: "4px 8px", fontSize: "0.78rem", borderColor: "var(--red)", color: "var(--red)" }}
                                                title="Delete Table"
                                                onClick={() => deleteTable(t)}
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

            {/* Add Table Modal */}
            {showAdd && (
                <div className="modal-overlay" onClick={() => setShowAdd(false)}>
                    <div className="card modal" onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 20 }}>+ Add New Restaurant Table</h2>
                        <div className="input-group">
                            <label className="input-label">Table Number</label>
                            <input
                                className="input"
                                type="number"
                                placeholder="Enter table number (e.g. 5)"
                                value={newNum}
                                onChange={(e) => setNewNum(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <p className="text-muted text-sm" style={{ marginBottom: 20 }}>
                            This table will be added to your active restaurant branch.
                        </p>
                        <div className="flex gap-2 justify-end">
                            <button className="btn btn-outline" onClick={() => setShowAdd(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={addTable}>Create Table</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Table Modal */}
            {editingTable && (
                <div className="modal-overlay" onClick={() => setEditingTable(null)}>
                    <div className="card modal" onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 20 }}>✏️ Edit Table Number</h2>
                        <div className="input-group">
                            <label className="input-label">Table Number</label>
                            <input
                                className="input"
                                type="number"
                                value={editNum}
                                onChange={(e) => setEditNum(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button className="btn btn-outline" onClick={() => setEditingTable(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={updateTableNumber}>Save Table</button>
                        </div>
                    </div>
                </div>
            )}

            {/* QR Modal */}
            {qrResult && (
                <div className="modal-overlay" onClick={() => setQrResult(null)}>
                    <div className="card modal" onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 12 }}>✅ Table {qrResult.table_number} — Smart Tablet & QR Link</h2>
                        <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                            Scan this QR code or open the link on the Table Tablet device to launch the AI Voice & Touch Ordering Kiosk:
                        </p>

                        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, background: "white", padding: 16, borderRadius: 8 }}>
                            <QRCodeCanvas
                                id="qr-canvas"
                                value={`${window.location.origin}${qrResult.kiosk_path || `/table/${qrResult.token}`}`}
                                size={200}
                                level="H"
                                includeMargin={true}
                            />
                        </div>

                        <div className="flex gap-2" style={{ marginBottom: 16, justifyContent: "center", flexWrap: "wrap" }}>
                            <button className="btn btn-outline" onClick={() => {
                                const canvas = document.getElementById("qr-canvas") as HTMLCanvasElement;
                                if (canvas) {
                                    const a = document.createElement("a");
                                    a.href = canvas.toDataURL("image/png");
                                    a.download = `Table-${qrResult.table_number}-Kiosk-QR.png`;
                                    a.click();
                                }
                            }}>
                                ⬇️ Download QR
                            </button>
                            <a
                                className="btn btn-primary"
                                href={`${window.location.origin}${qrResult.kiosk_path || `/table/${qrResult.token}`}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: "inline-flex", textDecoration: "none" }}
                            >
                                📱 Open Tablet Kiosk UI
                            </a>
                            <a
                                className="btn btn-outline"
                                href={qrResult.wa_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: "inline-flex", textDecoration: "none" }}
                            >
                                💬 WhatsApp Fallback
                            </a>
                        </div>

                        <div style={{ background: "var(--bg-base)", padding: 12, borderRadius: 8, wordBreak: "break-all", fontSize: "0.8rem", color: "var(--green)", marginBottom: 16 }}>
                            {`${window.location.origin}${qrResult.kiosk_path || `/table/${qrResult.token}`}`}
                        </div>

                        <div style={{ textAlign: "center" }}>
                            <button className="btn btn-outline" onClick={() => setQrResult(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
