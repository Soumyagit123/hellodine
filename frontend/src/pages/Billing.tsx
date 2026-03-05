import { useEffect, useState } from "react";
import api from "../api/client";

type Bill = {
    id: string;
    bill_number: string;
    table_id: string;
    table_number?: string;
    subtotal: number;
    cgst_amount: number;
    sgst_amount: number;
    total: number;
    status: string;
    created_at: string;
    closed_at: string | null;
};

function PayModal({ bill, onClose, onPaid }: { bill: Bill; onClose: () => void; onPaid: () => void }) {
    const [method, setMethod] = useState("CASH");
    const [amount, setAmount] = useState(String(bill.total));
    const [ref, setRef] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function pay() {
        setLoading(true);
        setError("");
        try {
            await api.post(`/billing/${bill.id}/pay`, {
                method,
                amount: parseFloat(amount),
                upi_reference_id: ref || null,
            });
            onPaid();
        } catch (e: any) {
            setError(e.response?.data?.detail || "Payment failed");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="card modal" onClick={(e) => e.stopPropagation()}>
                <h2 style={{ marginBottom: 20 }}>💳 Mark Payment — {bill.bill_number}</h2>

                <div style={{ background: "var(--bg-base)", borderRadius: 8, padding: "14px", marginBottom: 20 }}>
                    <div className="flex justify-between text-sm"><span className="text-muted">Subtotal</span><span>₹{Number(bill.subtotal).toFixed(2)}</span></div>
                    <div className="flex justify-between text-sm mt-1"><span className="text-muted">GST</span><span>₹{(Number(bill.cgst_amount) + Number(bill.sgst_amount)).toFixed(2)}</span></div>
                    <div className="flex justify-between mt-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                        <span style={{ fontWeight: 700 }}>Total</span>
                        <span style={{ fontWeight: 800, color: "var(--green)", fontSize: "1.1rem" }}>₹{Number(bill.total).toFixed(2)}</span>
                    </div>
                </div>

                <div className="input-group">
                    <label className="input-label">Payment Method</label>
                    <select className="select" style={{ width: "100%" }} value={method} onChange={(e) => setMethod(e.target.value)}>
                        <option value="CASH">💵 Cash</option>
                        <option value="UPI">📱 UPI</option>
                        <option value="CARD">💳 Card</option>
                    </select>
                </div>
                <div className="input-group">
                    <label className="input-label">Amount Received</label>
                    <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                {method !== "CASH" && (
                    <div className="input-group">
                        <label className="input-label">Reference / UTR</label>
                        <input className="input" type="text" placeholder="UPI ref / UTR number" value={ref} onChange={(e) => setRef(e.target.value)} />
                    </div>
                )}

                {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 12 }}>{error}</p>}

                <div className="flex gap-2">
                    <button className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
                    <button className="btn btn-success" onClick={pay} disabled={loading} style={{ flex: 1 }}>
                        {loading ? "Processing…" : "✅ Mark Paid"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function Billing() {
    const [bills, setBills] = useState<Bill[]>([]);
    const [selected, setSelected] = useState<Bill | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<"UNPAID" | "ALL">("UNPAID");
    const [filterDate, setFilterDate] = useState<string>(new Date().toISOString().split("T")[0]);

    async function fetchBills() {
        setLoading(true);
        const staff = JSON.parse(localStorage.getItem("hd_staff") || "{}");
        if (!staff.branch_id) return;

        try {
            // Fetch BOTH paid and unpaid for the selected date
            const res = await api.get(`/billing/transactions?branch_id=${staff.branch_id}&date=${filterDate}`);
            setBills(res.data);
        } catch (e) {
            console.error("Failed to fetch billing transactions:", e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { fetchBills(); }, [filterDate]);

    const unpaidBills = bills.filter(b => b.status === "UNPAID");
    const totalRevenue = bills.filter(b => b.status === "PAID").reduce((sum, b) => sum + Number(b.total), 0);

    return (
        <div>
            <div className="page-header" style={{ marginBottom: 16 }}>
                <div>
                    <h1 className="page-title">Billing & Transactions</h1>
                    <p className="page-sub">Monitor all today's payments and open tables</p>
                </div>
                <div className="flex gap-2">
                    <button className="btn btn-outline btn-sm" onClick={fetchBills}>🔄 Refresh</button>
                </div>
            </div>

            {/* TABS */}
            <div style={{ display: "flex", gap: 10, marginBottom: 24, borderBottom: "1px solid var(--border)" }}>
                <button
                    onClick={() => setActiveTab("UNPAID")}
                    style={{
                        padding: "10px 20px",
                        background: "none",
                        border: "none",
                        borderBottom: activeTab === "UNPAID" ? "3px solid var(--primary)" : "3px solid transparent",
                        color: activeTab === "UNPAID" ? "var(--primary)" : "var(--text)",
                        fontWeight: activeTab === "UNPAID" ? 700 : 500,
                        cursor: "pointer",
                        fontSize: "1rem"
                    }}
                >
                    Pending Payments ({unpaidBills.length})
                </button>
                <button
                    onClick={() => setActiveTab("ALL")}
                    style={{
                        padding: "10px 20px",
                        background: "none",
                        border: "none",
                        borderBottom: activeTab === "ALL" ? "3px solid var(--primary)" : "3px solid transparent",
                        color: activeTab === "ALL" ? "var(--primary)" : "var(--text)",
                        fontWeight: activeTab === "ALL" ? 700 : 500,
                        cursor: "pointer",
                        fontSize: "1rem"
                    }}
                >
                    Transactions Dashboard
                </button>
            </div>

            {loading ? (
                <div className="text-muted">Loading transactions…</div>
            ) : activeTab === "UNPAID" ? (
                /* UNPAID TILE VIEW */
                <>
                    {unpaidBills.length === 0 && (
                        <div className="card" style={{ textAlign: "center", padding: 40 }}>
                            <p style={{ fontSize: "2rem" }}>🎉</p>
                            <p className="text-muted mt-2">No pending bills right now.</p>
                        </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
                        {unpaidBills.map((bill) => (
                            <div key={bill.id} className="card" style={{ cursor: "pointer", border: "1px solid rgba(255,95,87,0.3)" }} onClick={() => setSelected(bill)}>
                                <div className="flex justify-between items-center">
                                    <span style={{ fontWeight: 800, fontSize: "1.1rem" }}>{bill.bill_number}</span>
                                    <span className="badge" style={{ background: "rgba(255,95,87,0.1)", color: "var(--red)" }}>UNPAID</span>
                                </div>
                                <div className="text-muted text-sm mt-1">Table: {bill.table_number || bill.table_id.slice(-6)}</div>
                                <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                                    <div className="flex justify-between text-sm"><span className="text-muted">Subtotal</span><span>₹{Number(bill.subtotal).toFixed(2)}</span></div>
                                    <div className="flex justify-between text-sm mt-1"><span className="text-muted">GST</span><span>₹{(Number(bill.cgst_amount) + Number(bill.sgst_amount)).toFixed(2)}</span></div>
                                    <div className="flex justify-between mt-2" style={{ fontWeight: 800, fontSize: "1.2rem", color: "var(--text)" }}>
                                        <span>Total</span><span>₹{Number(bill.total).toFixed(2)}</span>
                                    </div>
                                </div>
                                <button className="btn btn-success" style={{ width: "100%", marginTop: 14, justifyContent: "center" }}>
                                    💳 Mark as Paid
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                /* ALL TRANSACTIONS LIST VIEW */
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{ padding: "16px 20px", background: "rgba(52,199,89,0.05)", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
                            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Daily Revenue</h3>
                            <input
                                type="date"
                                className="input"
                                style={{ padding: "6px 10px", margin: 0 }}
                                value={filterDate}
                                onChange={(e) => setFilterDate(e.target.value)}
                            />
                        </div>
                        <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--green)" }}>₹{totalRevenue.toFixed(2)}</span>
                    </div>
                    {bills.length === 0 ? (
                        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>No transactions found for {filterDate}.</div>
                    ) : (
                        <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                                <thead>
                                    <tr style={{ borderBottom: "2px solid var(--border)", background: "var(--bg-base)" }}>
                                        <th style={{ padding: "12px 20px", color: "var(--muted)", fontWeight: 600, fontSize: "0.85rem", textTransform: "uppercase" }}>Time</th>
                                        <th style={{ padding: "12px 20px", color: "var(--muted)", fontWeight: 600, fontSize: "0.85rem", textTransform: "uppercase" }}>Bill #</th>
                                        <th style={{ padding: "12px 20px", color: "var(--muted)", fontWeight: 600, fontSize: "0.85rem", textTransform: "uppercase" }}>Table</th>
                                        <th style={{ padding: "12px 20px", color: "var(--muted)", fontWeight: 600, fontSize: "0.85rem", textTransform: "uppercase" }}>Amount</th>
                                        <th style={{ padding: "12px 20px", color: "var(--muted)", fontWeight: 600, fontSize: "0.85rem", textTransform: "uppercase" }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bills.map(b => (
                                        <tr key={b.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                            <td style={{ padding: "12px 20px", fontSize: "0.9rem" }}>
                                                {new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td style={{ padding: "12px 20px", fontWeight: 600 }}>{b.bill_number}</td>
                                            <td style={{ padding: "12px 20px" }}>{b.table_number || "Takeaway"}</td>
                                            <td style={{ padding: "12px 20px", fontWeight: 700 }}>₹{Number(b.total).toFixed(2)}</td>
                                            <td style={{ padding: "12px 20px" }}>
                                                {b.status === "PAID"
                                                    ? <span className="badge" style={{ background: "rgba(52,199,89,0.15)", color: "var(--green)" }}>PAID</span>
                                                    : <span className="badge" style={{ background: "rgba(255,95,87,0.15)", color: "var(--red)" }}>UNPAID</span>
                                                }
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {selected && (
                <PayModal bill={selected} onClose={() => setSelected(null)} onPaid={() => { setSelected(null); fetchBills(); }} />
            )}
        </div>
    );
}
