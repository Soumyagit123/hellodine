import { useEffect, useState, useRef } from "react";
import api, { WS_BASE_URL } from "../api/client";
import { formatDistanceToNow } from "date-fns";


const COLUMNS = [
    { status: "NEW", label: "🆕 New", color: "var(--blue)" },
    { status: "ACCEPTED", label: "✅ Accepted", color: "var(--yellow)" },
    { status: "PREPARING", label: "👨‍🍳 Preparing", color: "var(--orange)" },
    { status: "READY", label: "🔔 Ready", color: "var(--green)" },
    { status: "SERVED", label: "🍽️ Served", color: "var(--text-muted)" },
];

const NEXT_STATUS: Record<string, string> = {
    NEW: "ACCEPTED",
    ACCEPTED: "PREPARING",
    PREPARING: "READY",
    READY: "SERVED",
};

const STATUS_BTN: Record<string, string> = {
    NEW: "Accept",
    ACCEPTED: "Start Prep",
    PREPARING: "Mark Ready",
    READY: "Mark Served",
};

type Order = {
    id: string;
    order_number: string;
    table_id: string;
    table?: { table_number: number };
    status: string;
    total: number;
    created_at: string;
    items: {
        id: string;
        quantity: number;
        notes: string | null;
        menu_item_id: string;
        menu_item?: { name: string };
        variant?: { name: string };
        modifiers: { id: string; modifier_name_snapshot: string }[];
    }[];
};

function OrderCard({ 
    order, 
    onAdvance,
    isAdvancing,
}: { 
    order: Order; 
    onAdvance: (orderId: string, currentStatus: string, nextStatus: string) => void;
    isAdvancing?: boolean;
}) {
    const next = NEXT_STATUS[order.status];
    const elapsed = formatDistanceToNow(new Date(order.created_at), { addSuffix: false });
    const tableLabel = order.table?.table_number ?? order.table_id?.slice(-4) ?? "—";

    return (
        <div className="order-card">
            <div className="flex items-center justify-between">
                <div className="order-card-table">T{tableLabel}</div>
                <span className={`badge badge-${order.status.toLowerCase()}`}>{order.status}</span>
            </div>
            <div className="order-card-info">#{order.order_number} · {elapsed} ago</div>

            <div className="order-card-items">
                {order.items.map((item) => (
                    <div key={item.id} className="mb-2">
                        <div className="flex justify-between">
                            <span style={{ fontWeight: 600 }}>×{item.quantity} {item.menu_item?.name || item.menu_item_id.slice(0, 8)}</span>
                        </div>
                        {item.variant && (
                            <div className="text-xs text-muted" style={{ marginLeft: "1.5rem" }}>
                                ▫️ {item.variant.name}
                            </div>
                        )}
                        {item.modifiers?.map(mod => (
                            <div key={mod.id} className="text-xs text-muted" style={{ marginLeft: "1.5rem" }}>
                                + {mod.modifier_name_snapshot}
                            </div>
                        ))}
                        {item.notes && (
                            <div className="order-card-note mt-1">📝 {item.notes}</div>
                        )}
                    </div>
                ))}
            </div>

            <div className="order-card-footer">
                <span className="text-muted text-sm">₹{Number(order.total).toFixed(2)}</span>
                {next && (
                    <button 
                        className="btn btn-sm btn-primary" 
                        disabled={isAdvancing}
                        onClick={() => onAdvance(order.id, order.status, next)}
                    >
                        {isAdvancing ? "Updating…" : STATUS_BTN[order.status]}
                    </button>
                )}
            </div>
        </div>
    );
}

export default function OrdersBoard() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [branchId, setBranchId] = useState<string>("");
    const [birthdayBanner, setBirthdayBanner] = useState<{ table_number: string; birthday_name: string } | null>(null);
    const [advancingId, setAdvancingId] = useState<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

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

    async function fetchOrders() {
        if (!branchId) return;
        const res = await api.get(`/orders?branch_id=${branchId}`);
        setOrders(res.data);
    }

    useEffect(() => {
        if (!branchId) return;
        fetchOrders();

        const wsUrl = `${WS_BASE_URL}/orders/ws/kitchen/${branchId}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.event === "BIRTHDAY_CELEBRATION") {
                    setBirthdayBanner({
                        table_number: payload.table_number,
                        birthday_name: payload.birthday_name,
                    });
                } else if (payload.event === "ORDER_STATUS_UPDATED" && payload.order_id && payload.status) {
                    // Update state instantly from WebSocket broadcast without full refetch
                    setOrders((prev) =>
                        prev.map((o) => (o.id === payload.order_id ? { ...o, status: payload.status } : o))
                    );
                    return;
                }
            } catch {
                // ignore parse errors
            }
            fetchOrders();
        };
        ws.onclose = () => setTimeout(() => fetchOrders(), 3000);

        const interval = setInterval(fetchOrders, 15000); // Fallback polling
        return () => {
            ws.close();
            clearInterval(interval);
        };
    }, [branchId]);


    const activeOrders = orders.filter((o) => o.status !== "SERVED" && o.status !== "CANCELLED");

    function handleAdvance(orderId: string, currentStatus: string, nextStatus: string) {
        if (advancingId === orderId) return;
        setAdvancingId(orderId);

        // 1. Optimistic instant UI update (0ms latency for kitchen / cashier)
        setOrders((prev) =>
            prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o))
        );

        // 2. Background sync to backend / Supabase
        api.patch(`/orders/${orderId}/status`, { status: nextStatus })
            .catch((err) => {
                console.error("Failed to update status:", err);
                // Revert on network failure
                setOrders((prev) =>
                    prev.map((o) => (o.id === orderId ? { ...o, status: currentStatus } : o))
                );
                alert("Could not update order status. Please check your connection.");
            })
            .finally(() => {
                setAdvancingId(null);
            });
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Kitchen Board</h1>
                    <p className="page-sub">{activeOrders.length} active orders</p>
                </div>
                <div className="flex gap-2">
                    <div className="pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)", margin: "auto 0" }} />
                    <span className="text-sm text-muted">Live</span>
                    <button className="btn btn-outline btn-sm" onClick={fetchOrders}>Refresh</button>
                </div>
            </div>

            {birthdayBanner && (
                <div
                    className="card"
                    style={{
                        marginBottom: 18,
                        background: "linear-gradient(90deg, rgba(255,159,67,0.18), rgba(108,99,255,0.18))",
                        border: "1px solid var(--orange)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <div>
                        <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--orange)" }}>
                            🎂 Birthday Alert — Table T{birthdayBanner.table_number}!
                        </span>
                        <span style={{ marginLeft: 10, color: "var(--text)" }}>
                            Celebrating <strong>{birthdayBanner.birthday_name}</strong>'s birthday right now! 🎉
                        </span>
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={() => setBirthdayBanner(null)}>Dismiss</button>
                </div>
            )}


            <div className="kanban">
                {COLUMNS.map((col) => {
                    const colOrders = orders.filter((o) => o.status === col.status);
                    return (
                        <div key={col.status} className="kanban-col">
                            <div className="kanban-col-header">
                                <span style={{ color: col.color }}>{col.label}</span>
                                <span style={{ background: col.color, color: "#0f0f1a", borderRadius: "999px", padding: "1px 8px", fontSize: "0.75rem", fontWeight: 700 }}>
                                    {colOrders.length}
                                </span>
                            </div>
                            <div className="kanban-col-body">
                                {colOrders.length === 0 && (
                                    <p className="text-muted text-sm" style={{ textAlign: "center", marginTop: 20 }}>No orders</p>
                                )}
                                {colOrders.map((o) => (
                                    <OrderCard 
                                        key={o.id} 
                                        order={o} 
                                        onAdvance={handleAdvance} 
                                        isAdvancing={advancingId === o.id}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
