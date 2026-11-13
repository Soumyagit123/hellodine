import { useEffect, useState, useRef } from "react";
import api, { WS_BASE_URL } from "../api/client";
import { formatDistanceToNow } from "date-fns";
import { useBranch } from "../context/BranchContext";


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
    userRole,
    onAdvance,
    isAdvancing,
}: { 
    order: Order; 
    userRole: string;
    onAdvance: (orderId: string, currentStatus: string, nextStatus: string) => void;
    isAdvancing?: boolean;
}) {
    const next = NEXT_STATUS[order.status];
    const elapsed = formatDistanceToNow(new Date(order.created_at), { addSuffix: false });
    const tableLabel = order.table?.table_number ?? order.table_id?.slice(-4) ?? "—";

    // Role-based permissions:
    // KITCHEN (Chef): can advance NEW -> ACCEPTED -> PREPARING -> READY
    // CASHIER: can advance READY -> SERVED (delivery to table)
    // ADMINS (SYSTEM_ADMIN, SUPER_ADMIN, BRANCH_ADMIN): View-only monitoring (cannot accept/prep/serve routine orders)
    const isKitchenRole = userRole === "KITCHEN";
    const isCashierRole = userRole === "CASHIER";
    const isAdmin = ["SYSTEM_ADMIN", "SUPER_ADMIN", "BRANCH_ADMIN"].includes(userRole);

    let canAdvance = false;
    let helperMessage = "";

    if (isKitchenRole) {
        if (["NEW", "ACCEPTED", "PREPARING"].includes(order.status)) {
            canAdvance = true;
        } else if (order.status === "READY") {
            helperMessage = "Waiting for Cashier / Server";
        }
    } else if (isCashierRole) {
        if (order.status === "READY") {
            canAdvance = true;
        } else if (["NEW", "ACCEPTED", "PREPARING"].includes(order.status)) {
            helperMessage = "In Kitchen Prep";
        }
    } else if (isAdmin) {
        // Admins are supervisory / monitoring only — they cannot prepare or serve food
        canAdvance = false;
        if (["NEW", "ACCEPTED", "PREPARING"].includes(order.status)) {
            helperMessage = "Cooking in Kitchen";
        } else if (order.status === "READY") {
            helperMessage = "Ready for Table Service";
        }
    } else {
        canAdvance = false;
    }

    const isServed = order.status === "SERVED";
    const [isExpanded, setIsExpanded] = useState(!isServed);

    if (isServed && !isExpanded) {
        return (
            <div 
                className="order-card" 
                style={{ 
                    padding: "8px 12px", 
                    cursor: "pointer", 
                    opacity: 0.8,
                    background: "rgba(255, 255, 255, 0.03)" 
                }}
                onClick={() => setIsExpanded(true)}
                title="Click to view details"
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span style={{ fontWeight: 800, fontSize: "1.1rem" }}>T{tableLabel}</span>
                        <span className="text-xs text-muted">#{order.order_number}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="badge badge-served" style={{ fontSize: "0.7rem", padding: "2px 6px" }}>SERVED</span>
                        <span className="text-xs text-muted">₹{Number(order.total).toFixed(0)}</span>
                    </div>
                </div>
                <div className="text-xs text-muted mt-1 truncate" style={{ maxWidth: "100%" }}>
                    {order.items.map(i => `${i.quantity}x ${i.menu_item?.name || 'Item'}`).join(", ")}
                </div>
            </div>
        );
    }

    return (
        <div className="order-card">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="order-card-table">T{tableLabel}</div>
                    {isServed && (
                        <button 
                            className="btn btn-outline" 
                            style={{ padding: "2px 6px", fontSize: "0.7rem", height: "auto" }}
                            onClick={() => setIsExpanded(false)}
                            title="Collapse"
                        >
                            Collapse ▲
                        </button>
                    )}
                </div>
                <span className={`badge badge-${order.status.toLowerCase()}`}>{order.status}</span>
            </div>
            <div className="order-card-info">#{order.order_number} · {elapsed} ago</div>

            <div className="order-card-items">
                {order.items.map((item) => (
                    <div key={item.id} className="mb-1">
                        <div className="flex justify-between">
                            <span style={{ fontWeight: 600 }}>×{item.quantity} {item.menu_item?.name || item.menu_item_id.slice(0, 8)}</span>
                            {(userRole === "KITCHEN" || userRole === "CASHIER") && order.status === "NEW" && (
                                <button
                                    type="button"
                                    title={`Reject ${item.menu_item?.name || "item"} (unavailable / finished)`}
                                    onClick={async (e) => {
                                        const btn = e.currentTarget;
                                        const row = btn.closest(".order-card-item") as HTMLElement | null;
                                        if (row) {
                                            row.style.opacity = "0.4";
                                            row.style.pointerEvents = "none";
                                        }
                                        btn.disabled = true;
                                        btn.textContent = "…";
                                        try {
                                            await api.post(`/orders/${order.id}/items/${item.id}/reject`);
                                        } finally {
                                            if (row) {
                                                row.style.opacity = "1";
                                                row.style.pointerEvents = "auto";
                                            }
                                        }
                                    }}
                                    style={{
                                        marginLeft: "auto",
                                        background: "transparent",
                                        border: "1px solid rgba(248,113,113,0.4)",
                                        color: "#f87171",
                                        borderRadius: 4,
                                        padding: "0 5px",
                                        fontSize: "0.7rem",
                                        cursor: "pointer",
                                        lineHeight: "16px",
                                    }}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                        {item.variant && (
                            <div className="text-xs text-muted" style={{ marginLeft: "1.2rem" }}>
                                ▫️ {item.variant.name}
                            </div>
                        )}
                        {item.modifiers?.map(mod => (
                            <div key={mod.id} className="text-xs text-muted" style={{ marginLeft: "1.2rem" }}>
                                + {mod.modifier_name_snapshot}
                            </div>
                        ))}
                        {item.notes && (
                            <div className="order-card-note mt-1">📝 {item.notes}</div>
                        )}
                    </div>
                ))}
            </div>

            <div className="order-card-footer" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", justifyContent: "space-between" }}>
                <span className="text-muted text-sm font-semibold">₹{Number(order.total).toFixed(2)}</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {next && canAdvance && (
                    <button 
                        className="btn btn-sm btn-primary"
                        style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                        disabled={isAdvancing}
                        onClick={() => onAdvance(order.id, order.status, next)}
                    >
                        {isAdvancing ? "Updating…" : STATUS_BTN[order.status]}
                    </button>
                )}
                </div>
                {next && !canAdvance && helperMessage && (
                    <span 
                        className="text-xs text-muted" 
                        style={{ 
                            background: "rgba(255, 255, 255, 0.05)", 
                            padding: "4px 8px", 
                            borderRadius: 6,
                            border: "1px dashed rgba(255, 255, 255, 0.15)"
                        }}
                    >
                        {helperMessage}
                    </span>
                )}
            </div>
        </div>
    );
}

export default function OrdersBoard() {
    const { selectedBranchId } = useBranch();
    const [orders, setOrders] = useState<Order[]>([]);
    const [branchId, setBranchId] = useState<string>("");
    const [userRole, setUserRole] = useState<string>("");
    const [birthdayBanner, setBirthdayBanner] = useState<{ table_number: string; birthday_name: string } | null>(null);
    const [advancingId, setAdvancingId] = useState<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        const staff = JSON.parse(localStorage.getItem("hd_staff") || "{}");
        if (staff.role) {
            setUserRole(staff.role);
        }
        if (staff.branch_id) {
            setBranchId(staff.branch_id);
        } else if (selectedBranchId) {
            setBranchId(selectedBranchId);
        }
    }, [selectedBranchId]);

    async function fetchOrders() {
        if (!branchId) return;
        const res = await api.get(`/orders?branch_id=${branchId}`);
        setOrders(res.data);
    }

    useEffect(() => {
        if (!branchId) return;
        fetchOrders();

        let isUnmounted = false;
        let reconnectTimeout: any = null;
        const wsUrl = `${WS_BASE_URL}/orders/ws/kitchen/${branchId}`;

        function connectWs() {
            if (isUnmounted) return;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                // Instantly sync latest orders as soon as WebSocket connects/reconnects
                fetchOrders();
            };

            ws.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.event === "BIRTHDAY_CELEBRATION") {
                        setBirthdayBanner({
                            table_number: payload.table_number,
                            birthday_name: payload.birthday_name,
                        });
                        return;
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

        // Option A Smart Fallback: Only poll if WebSocket is NOT currently connected
        const interval = setInterval(() => {
            const currentWs = wsRef.current;
            if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
                fetchOrders();
            }
        }, 15000);

        return () => {
            isUnmounted = true;
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            clearInterval(interval);
            if (wsRef.current) wsRef.current.close();
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
        <div className="kanban-wrapper">
            <div className="page-header" style={{ marginBottom: 12 }}>
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
                                        userRole={userRole}
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
