import { useEffect, useState, useRef } from "react";
import api, { WS_BASE_URL } from "../api/client";

type Bill = {
    id: string;
    bill_number: string;
    table_id: string;
    table_number?: string;
    customer_name?: string;
    subtotal: number;
    cgst_amount: number;
    sgst_amount: number;
    total: number;
    status: string;
    created_at: string;
    closed_at: string | null;
};

type PaymentNotification = {
    id: string;
    table_number: string | number;
    bill_number: string;
    amount: number;
    method: string;
    upi_reference_id?: string;
    paid_at: string;
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

function getLocalDateString(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export default function Billing() {
    const [bills, setBills] = useState<Bill[]>([]);
    const [selected, setSelected] = useState<Bill | null>(null);
    const [loading, setLoading] = useState(true);
    const [branchId, setBranchId] = useState<string>("");
    const [activeTab, setActiveTab] = useState<"UNPAID" | "ALL">("UNPAID");
    const [filterDate, setFilterDate] = useState<string>(getLocalDateString());
    const [notifications, setNotifications] = useState<PaymentNotification[]>([]);
    const wsRef = useRef<WebSocket | null>(null);
    const isFetchingRef = useRef(false);

    useEffect(() => {
        const staff = JSON.parse(localStorage.getItem("hd_staff") || "{}");
        const selectedBranch = localStorage.getItem("hd_selected_branch");
        if (staff.branch_id) {
            setBranchId(staff.branch_id);
        } else if (selectedBranch) {
            setBranchId(selectedBranch);
        } else if (staff.restaurant_id) {
            api.get(`/admin/branches?restaurant_id=${staff.restaurant_id}`).then((r) => {
                if (r.data.length > 0) setBranchId(r.data[0].id);
            });
        }
    }, []);

    async function fetchBills(targetBranchId = branchId, showLoader = false) {
        if (!targetBranchId || isFetchingRef.current) return;
        isFetchingRef.current = true;
        if (showLoader) setLoading(true);
        try {
            const res = await api.get(`/billing/transactions?branch_id=${targetBranchId}&date=${filterDate}`);
            setBills(res.data);
        } catch (e) {
            console.error("Failed to fetch billing transactions:", e);
        } finally {
            if (showLoader) setLoading(false);
            isFetchingRef.current = false;
        }
    }

    useEffect(() => {
        if (!branchId) return;
        fetchBills(branchId, bills.length === 0);
    }, [branchId, filterDate]);

    useEffect(() => {
        if (!branchId) return;

        let isUnmounted = false;
        let reconnectTimeout: any = null;
        const wsUrl = `${WS_BASE_URL}/orders/ws/kitchen/${branchId}`;

        function connectWs() {
            if (isUnmounted) return;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                // Refresh bills as soon as connected/reconnected
                fetchBills(branchId, false);
            };

            ws.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.event === "TABLE_QR_BILL_PAID" || payload.event === "BILL_PAID") {
                        const notif: PaymentNotification = {
                            id: `${payload.bill_id}-${Date.now()}`,
                            table_number: payload.table_number || "—",
                            bill_number: payload.bill_number,
                            amount: Number(payload.amount),
                            method: payload.method || "UPI (Table QR)",
                            upi_reference_id: payload.upi_reference_id,
                            paid_at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                        };
                        setNotifications((prev) => [notif, ...prev].slice(0, 5));

                        // Instantly reflect payment in local state with 0ms delay:
                        setBills((prev) =>
                            prev.map((b) => {
                                if (
                                    b.id === payload.bill_id ||
                                    b.bill_number === payload.bill_number ||
                                    (payload.table_number && String(b.table_number) === String(payload.table_number))
                                ) {
                                    return {
                                        ...b,
                                        status: "PAID",
                                        closed_at: new Date().toISOString(),
                                        total: Number(payload.amount || b.total),
                                    };
                                }
                                return b;
                            })
                        );

                        fetchBills(branchId, false);
                    } else if (
                        payload.event === "NEW_ORDER" ||
                        payload.event === "ORDER_STATUS_UPDATED" ||
                        payload.event === "BILL_UPDATED"
                    ) {
                        fetchBills(branchId, false);
                    }
                } catch {
                    // ignore
                }
            };

            ws.onclose = () => {
                if (!isUnmounted) {
                    reconnectTimeout = setTimeout(connectWs, 3000);
                }
            };

            ws.onerror = () => {
                ws.close();
            };
        }

        connectWs();

        // Smart WebSocket Fallback: only poll if WebSocket is NOT currently open
        const poll = setInterval(() => {
            const currentWs = wsRef.current;
            if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
                fetchBills(branchId, false);
            }
        }, 15000);

        return () => {
            isUnmounted = true;
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            clearInterval(poll);
            if (wsRef.current) wsRef.current.close();
        };
    }, [branchId, filterDate]);


    const unpaidBills = bills.filter(b => b.status === "UNPAID");
    const totalRevenue = bills.filter(b => b.status === "PAID").reduce((sum, b) => sum + Number(b.total), 0);

    return (
        <div>
            <div className="page-header" style={{ marginBottom: 16 }}>
                <div>
                    <h1 className="page-title">Billing & Transactions</h1>
                    <p className="page-sub">Monitor all today's payments and open tables (Live Table QR Sync)</p>
                </div>
                <div className="flex gap-2">
                    <div className="pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)", margin: "auto 0" }} />
                    <span className="text-sm text-muted" style={{ margin: "auto 4px auto 0" }}>Live Cashier Feed</span>
                    <button className="btn btn-outline btn-sm" onClick={() => fetchBills()}>🔄 Refresh</button>
                </div>
            </div>

            {notifications.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                    {notifications.map((n) => (
                        <div
                            key={n.id}
                            className="card"
                            style={{
                                background: "linear-gradient(90deg, rgba(35,209,139,0.18) 0%, rgba(26,26,46,0.95) 100%)",
                                border: "1px solid var(--green)",
                                padding: "14px 18px",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                            }}
                        >
                            <div>
                                <div style={{ fontWeight: 800, color: "var(--green)", fontSize: "1.02rem" }}>
                                    🔔 Payment Received — Table T{n.table_number} Paid ₹{n.amount.toFixed(2)}!
                                </div>
                                <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                                    Bill <strong>#{n.bill_number}</strong> · Method: <strong>{n.method}</strong>
                                    {n.upi_reference_id ? ` · Ref: ${n.upi_reference_id}` : ""} · {n.paid_at} · Table Session Closed
                                </div>
                            </div>
                            <button
                                className="btn btn-outline btn-sm"
                                onClick={() => setNotifications((prev) => prev.filter((x) => x.id !== n.id))}
                            >
                                Dismiss
                            </button>
                        </div>
                    ))}
                </div>
            )}


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
                                <div className="text-muted text-sm mt-1">
                                    Table: <strong>T{bill.table_number || bill.table_id.slice(-6)}</strong>
                                    {bill.customer_name ? ` · 👤 ${bill.customer_name}` : ""}
                                </div>
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
                                        <th style={{ padding: "12px 20px", color: "var(--muted)", fontWeight: 600, fontSize: "0.85rem", textTransform: "uppercase" }}>Customer & Table</th>
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
                                            <td style={{ padding: "12px 20px" }}>
                                                <div style={{ fontWeight: 700 }}>{b.customer_name || "Guest"}</div>
                                                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Table T{b.table_number || "—"}</div>
                                            </td>
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
                <PayModal
                    bill={selected}
                    onClose={() => setSelected(null)}
                    onPaid={() => {
                        const paidId = selected.id;
                        setSelected(null);
                        setBills((prev) =>
                            prev.map((b) => (b.id === paidId ? { ...b, status: "PAID", closed_at: new Date().toISOString() } : b))
                        );
                        fetchBills(branchId, false);
                    }}
                />
            )}
        </div>
    );
}
