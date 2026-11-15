import { useEffect, useState, useRef } from "react";
import api, { WS_BASE_URL, getClientCached, isClientCacheFresh, invalidateClientCachePrefix } from "../api/client";
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
            helperMessage = "On the way — Waiter confirms on Table Kiosk";
        }
    } else if (isCashierRole) {
        if (order.status === "READY") {
            canAdvance = false;
            helperMessage = "Waiter confirms delivery on Table Kiosk";
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
    const initialStaff = (() => {
        try {
            return JSON.parse(localStorage.getItem("hd_staff") || "{}");
        } catch {
            return {};
        }
    })();
    const initialRole = initialStaff.role || "";
    const initialFilterMode: "today" | "all" | "date" = ["BRANCH_ADMIN", "SUPER_ADMIN", "SYSTEM_ADMIN"].includes(initialRole)
        ? "all"
        : "today";

    const initialBranchId = initialStaff.branch_id || selectedBranchId || localStorage.getItem("hd_selected_branch") || "";
    const initialOrdersUrl = initialBranchId
        ? `/orders?branch_id=${initialBranchId}&served_filter=${encodeURIComponent(initialFilterMode)}`
        : "";

    const [orders, setOrders] = useState<Order[]>(() => (initialOrdersUrl ? getClientCached<Order[]>(initialOrdersUrl) || [] : []));
    const [branchId, setBranchId] = useState<string>(initialBranchId);
    const [userRole, setUserRole] = useState<string>(initialRole);
    const [birthdayBanner, setBirthdayBanner] = useState<{ table_number: string; birthday_name: string } | null>(null);
    const [advancingId, setAdvancingId] = useState<string | null>(null);
    // Served column filter: Cashier defaults to "today", Admins default to "all"
    const [servedFilterMode, setServedFilterMode] = useState<"today" | "all" | "date">(initialFilterMode);
    const [servedFilterDate, setServedFilterDate] = useState<string>(() => new Date().toLocaleDateString("en-CA"));
    // Super Admin Orders Table multi-key filter state
    const [adminSearchKey, setAdminSearchKey] = useState<string>("");
    const [adminStatusFilter, setAdminStatusFilter] = useState<string>("ALL");
    const [adminTableFilter, setAdminTableFilter] = useState<string>("ALL");
    const [adminSortKey, setAdminSortKey] = useState<"NEWEST" | "OLDEST" | "HIGH_TOTAL" | "LOW_TOTAL">("NEWEST");
    const wsRef = useRef<WebSocket | null>(null);
    const servedFilterParamRef = useRef<string>(initialFilterMode);
    const lastFetchTsRef = useRef<number>(0);

    useEffect(() => {
        if (selectedBranchId && !initialStaff.branch_id) {
            setBranchId(selectedBranchId);
        }
    }, [selectedBranchId]);

    function getServedFilterParam(mode = servedFilterMode, dateVal = servedFilterDate): string {
        if (mode === "all") return "all";
        if (mode === "date" && dateVal) return dateVal;
        return "today";
    }

    async function fetchOrders(customServedFilter?: string, forceNetwork = false) {
        if (!branchId) return;
        const sf = customServedFilter ?? servedFilterParamRef.current;
        const url = `/orders?branch_id=${branchId}&served_filter=${encodeURIComponent(sf)}`;
        const cached = getClientCached<Order[]>(url);
        if (cached) {
            setOrders(cached);
            // If cache is fresh and we aren't forcing a live WebSocket refresh, skip the network hit!
            if (!forceNetwork && isClientCacheFresh(url, 60_000)) {
                return;
            }
        }
        lastFetchTsRef.current = Date.now();
        const res = await api.get(url);
        setOrders(res.data);
    }

    useEffect(() => {
        const param = getServedFilterParam(servedFilterMode, servedFilterDate);
        servedFilterParamRef.current = param;
        if (branchId) {
            fetchOrders(param, false);
        }
    }, [branchId, servedFilterMode, servedFilterDate]);

    useEffect(() => {
        if (!branchId) return;

        let isUnmounted = false;
        let reconnectTimeout: any = null;
        let connectDelayTimeout: any = null;
        const wsUrl = `${WS_BASE_URL}/orders/ws/kitchen/${branchId}`;

        function connectWs() {
            if (isUnmounted) return;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                // Only sync on WS reconnect if cache is not fresh
                const sf = servedFilterParamRef.current;
                const url = `/orders?branch_id=${branchId}&served_filter=${encodeURIComponent(sf)}`;
                if (!isClientCacheFresh(url, 60_000) && Date.now() - lastFetchTsRef.current > 3000) {
                    fetchOrders(sf, true);
                }
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
                        invalidateClientCachePrefix(`/orders?branch_id=${branchId}`);
                        return;
                    }
                } catch {
                    // ignore parse errors
                }
                invalidateClientCachePrefix(`/orders?branch_id=${branchId}`);
                fetchOrders(undefined, true);
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

        // Delay WS creation by 50ms so React 18 StrictMode's instant dev unmount doesn't open 2 sockets
        connectDelayTimeout = setTimeout(connectWs, 50);

        // Option A Smart Fallback: Only poll if WebSocket is NOT currently connected
        const interval = setInterval(() => {
            const currentWs = wsRef.current;
            if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
                fetchOrders(undefined, true);
            }
        }, 15000);

        return () => {
            isUnmounted = true;
            if (connectDelayTimeout) clearTimeout(connectDelayTimeout);
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            clearInterval(interval);
            if (wsRef.current) wsRef.current.close();
        };
    }, [branchId]);


    const activeOrders = orders.filter((o) => o.status !== "SERVED" && o.status !== "CANCELLED");

    // Helper: check if an order's created_at timestamp matches the selected Served filter
    const todayDateStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local timezone
    function matchesServedFilter(createdAt?: string): boolean {
        if (servedFilterMode === "all") return true;
        if (!createdAt) return false;
        const d = new Date(createdAt);
        if (isNaN(d.getTime())) return false;
        const orderDateStr = d.toLocaleDateString("en-CA");
        if (servedFilterMode === "date") {
            return orderDateStr === (servedFilterDate || todayDateStr);
        }
        return orderDateStr === todayDateStr;
    }

    // Chef (KITCHEN) does not see the SERVED column; Cashier and Admins see SERVED with filter controls
    const visibleColumns = userRole === "KITCHEN"
        ? COLUMNS.filter((col) => col.status !== "SERVED")
        : COLUMNS;

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

    const isSuperAdminView = userRole === "SUPER_ADMIN" || userRole === "SYSTEM_ADMIN";

    // Unique table numbers for Super Admin table dropdown filter
    const availableTables = Array.from(
        new Set(
            orders
                .map((o) => o.table?.table_number)
                .filter((num): num is number => typeof num === "number")
        )
    ).sort((a, b) => a - b);

    // Filtered & sorted orders for Super Admin Orders Table view
    const superAdminFilteredOrders = orders
        .filter((o) => {
            // 1. Date filter (All / Today / Specific Date)
            if (!matchesServedFilter(o.created_at)) return false;

            // 2. Status filter
            if (adminStatusFilter === "ACTIVE") {
                if (!["NEW", "ACCEPTED", "PREPARING", "READY"].includes(o.status)) return false;
            } else if (adminStatusFilter !== "ALL") {
                if (o.status !== adminStatusFilter) return false;
            }

            // 3. Table filter
            if (adminTableFilter !== "ALL") {
                const tNum = String(o.table?.table_number ?? "");
                if (tNum !== adminTableFilter) return false;
            }

            // 4. Search keyword filter (Order #, Table #, Dish Name, Notes)
            if (adminSearchKey.trim()) {
                const q = adminSearchKey.trim().toLowerCase();
                const ordNum = (o.order_number || "").toLowerCase();
                const tblStr = `t${o.table?.table_number ?? ""}`.toLowerCase();
                const itemsMatch = (o.items || []).some(
                    (it) =>
                        (it.menu_item?.name || "").toLowerCase().includes(q) ||
                        (it.notes || "").toLowerCase().includes(q)
                );
                if (!ordNum.includes(q) && !tblStr.includes(q) && !itemsMatch) {
                    return false;
                }
            }

            return true;
        })
        .sort((a, b) => {
            if (adminSortKey === "OLDEST") {
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            }
            if (adminSortKey === "HIGH_TOTAL") {
                return Number(b.total) - Number(a.total);
            }
            if (adminSortKey === "LOW_TOTAL") {
                return Number(a.total) - Number(b.total);
            }
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

    if (isSuperAdminView) {
        const filteredRevenue = superAdminFilteredOrders
            .filter((o) => o.status !== "CANCELLED")
            .reduce((sum, o) => sum + Number(o.total || 0), 0);

        return (
            <div style={{ maxWidth: 1400, margin: "0 auto", paddingBottom: 32 }}>
                <div className="page-header" style={{ marginBottom: 16 }}>
                    <div>
                        <h1 className="page-title">Orders Directory & Audit Table</h1>
                        <p className="page-sub">
                            Filter and inspect all branch orders by Order #, Table, Status, Dish Name, Date, and Amount
                        </p>
                    </div>
                    <div className="flex gap-2 items-center">
                        <div
                            className="pulse"
                            style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)" }}
                        />
                        <span className="text-sm text-muted">Live Sync</span>
                        <button className="btn btn-outline btn-sm" onClick={() => fetchOrders()}>
                            🔄 Refresh
                        </button>
                    </div>
                </div>

                {/* SUMMARY METRICS STRIP */}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
                        gap: 12,
                        marginBottom: 16,
                    }}
                >
                    <div className="card card-sm" style={{ padding: "12px 16px" }}>
                        <div className="text-muted" style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                            MATCHING ORDERS
                        </div>
                        <div style={{ fontSize: "1.55rem", fontWeight: 800, color: "var(--text)" }}>
                            {superAdminFilteredOrders.length}
                        </div>
                    </div>
                    <div className="card card-sm" style={{ padding: "12px 16px" }}>
                        <div className="text-muted" style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                            ACTIVE IN KITCHEN
                        </div>
                        <div style={{ fontSize: "1.55rem", fontWeight: 800, color: "var(--orange)" }}>
                            {
                                superAdminFilteredOrders.filter((o) =>
                                    ["NEW", "ACCEPTED", "PREPARING", "READY"].includes(o.status)
                                ).length
                            }
                        </div>
                    </div>
                    <div className="card card-sm" style={{ padding: "12px 16px" }}>
                        <div className="text-muted" style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                            SERVED ORDERS
                        </div>
                        <div style={{ fontSize: "1.55rem", fontWeight: 800, color: "var(--green)" }}>
                            {superAdminFilteredOrders.filter((o) => o.status === "SERVED").length}
                        </div>
                    </div>
                    <div className="card card-sm" style={{ padding: "12px 16px" }}>
                        <div className="text-muted" style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                            MATCHING ORDER VALUE
                        </div>
                        <div style={{ fontSize: "1.55rem", fontWeight: 800, color: "var(--accent)" }}>
                            ₹{filteredRevenue.toFixed(0)}
                        </div>
                    </div>
                </div>

                {/* MULTI-KEY FILTER BAR */}
                <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
                            gap: 12,
                            alignItems: "end",
                        }}
                    >
                        {/* 1. Search by Order #, Table, or Dish */}
                        <div>
                            <label className="input-label" style={{ display: "block", marginBottom: 5 }}>
                                🔍 Search (Order #, Dish, Table)
                            </label>
                            <input
                                type="text"
                                className="input"
                                placeholder="e.g. ORD-155, Biryani, T3..."
                                value={adminSearchKey}
                                onChange={(e) => setAdminSearchKey(e.target.value)}
                                style={{ padding: "8px 12px", fontSize: "0.85rem" }}
                            />
                        </div>

                        {/* 2. Filter by Status */}
                        <div>
                            <label className="input-label" style={{ display: "block", marginBottom: 5 }}>
                                📌 Order Status
                            </label>
                            <select
                                className="select"
                                value={adminStatusFilter}
                                onChange={(e) => setAdminStatusFilter(e.target.value)}
                                style={{ width: "100%", padding: "8px 12px", fontSize: "0.85rem" }}
                            >
                                <option value="ALL">All Statuses</option>
                                <option value="ACTIVE">🔥 Active (Kitchen + Ready)</option>
                                <option value="SERVED">🍽️ Served</option>
                                <option value="NEW">🆕 New</option>
                                <option value="ACCEPTED">✅ Accepted</option>
                                <option value="PREPARING">👨‍🍳 Preparing</option>
                                <option value="READY">🔔 Ready</option>
                                <option value="CANCELLED">❌ Cancelled</option>
                            </select>
                        </div>

                        {/* 3. Filter by Table */}
                        <div>
                            <label className="input-label" style={{ display: "block", marginBottom: 5 }}>
                                🪑 Table Number
                            </label>
                            <select
                                className="select"
                                value={adminTableFilter}
                                onChange={(e) => setAdminTableFilter(e.target.value)}
                                style={{ width: "100%", padding: "8px 12px", fontSize: "0.85rem" }}
                            >
                                <option value="ALL">All Tables</option>
                                {availableTables.map((num) => (
                                    <option key={num} value={String(num)}>
                                        Table T{num}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* 4. Filter by Date (All / Today / Date Picker) */}
                        <div>
                            <label className="input-label" style={{ display: "block", marginBottom: 5 }}>
                                📅 Date Range
                            </label>
                            <div className="flex gap-2 items-center">
                                <button
                                    type="button"
                                    className="btn btn-sm"
                                    style={{
                                        padding: "7px 10px",
                                        background: servedFilterMode === "all" ? "var(--accent)" : "rgba(255,255,255,0.06)",
                                        color: servedFilterMode === "all" ? "#fff" : "var(--text-muted)",
                                    }}
                                    onClick={() => setServedFilterMode("all")}
                                >
                                    All
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-sm"
                                    style={{
                                        padding: "7px 10px",
                                        background: servedFilterMode === "today" ? "var(--accent)" : "rgba(255,255,255,0.06)",
                                        color: servedFilterMode === "today" ? "#fff" : "var(--text-muted)",
                                    }}
                                    onClick={() => setServedFilterMode("today")}
                                >
                                    Today
                                </button>
                                <input
                                    type="date"
                                    value={servedFilterDate}
                                    max={todayDateStr}
                                    onChange={(e) => {
                                        setServedFilterDate(e.target.value);
                                        setServedFilterMode("date");
                                    }}
                                    style={{
                                        flex: 1,
                                        minWidth: 120,
                                        padding: "6px 8px",
                                        fontSize: "0.8rem",
                                        borderRadius: 6,
                                        background: servedFilterMode === "date" ? "rgba(108,99,255,0.2)" : "var(--bg-base)",
                                        border: servedFilterMode === "date" ? "1px solid var(--accent)" : "1px solid var(--border)",
                                        color: "var(--text)",
                                        colorScheme: "dark",
                                    }}
                                />
                            </div>
                        </div>

                        {/* 5. Sort By + Reset */}
                        <div>
                            <label className="input-label" style={{ display: "block", marginBottom: 5 }}>
                                ↕️ Sort By
                            </label>
                            <div className="flex gap-2">
                                <select
                                    className="select"
                                    value={adminSortKey}
                                    onChange={(e) => setAdminSortKey(e.target.value as any)}
                                    style={{ flex: 1, padding: "8px 10px", fontSize: "0.85rem" }}
                                >
                                    <option value="NEWEST">Newest First</option>
                                    <option value="OLDEST">Oldest First</option>
                                    <option value="HIGH_TOTAL">Amount: High → Low</option>
                                    <option value="LOW_TOTAL">Amount: Low → High</option>
                                </select>
                                <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() => {
                                        setAdminSearchKey("");
                                        setAdminStatusFilter("ALL");
                                        setAdminTableFilter("ALL");
                                        setServedFilterMode("all");
                                        setAdminSortKey("NEWEST");
                                    }}
                                    title="Reset all filters"
                                >
                                    Reset
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ORDERS TABLE */}
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Order #</th>
                                    <th>Table</th>
                                    <th>Ordered Items</th>
                                    <th>Status</th>
                                    <th>Total Amount</th>
                                    <th>Date & Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {superAdminFilteredOrders.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: 32 }}>
                                            No orders match the selected filters.
                                        </td>
                                    </tr>
                                ) : (
                                    superAdminFilteredOrders.map((o) => {
                                        const tableLabel = o.table?.table_number ?? o.table_id?.slice(-4) ?? "—";
                                        const dt = o.created_at ? new Date(o.created_at) : null;
                                        return (
                                            <tr key={o.id}>
                                                <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                                                    #{o.order_number}
                                                </td>
                                                <td>
                                                    <span
                                                        style={{
                                                            fontWeight: 800,
                                                            padding: "3px 10px",
                                                            borderRadius: 6,
                                                            background: "rgba(108, 99, 255, 0.15)",
                                                            color: "var(--accent)",
                                                        }}
                                                    >
                                                        T{tableLabel}
                                                    </span>
                                                </td>
                                                <td style={{ maxWidth: 420 }}>
                                                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                                        {o.items.map((item) => (
                                                            <div key={item.id} style={{ fontSize: "0.84rem" }}>
                                                                <span style={{ fontWeight: 600 }}>
                                                                    {item.quantity}× {item.menu_item?.name || "Item"}
                                                                </span>
                                                                {item.variant && (
                                                                    <span className="text-muted" style={{ fontSize: "0.76rem", marginLeft: 6 }}>
                                                                        ({item.variant.name})
                                                                    </span>
                                                                )}
                                                                {item.notes && (
                                                                    <span style={{ color: "var(--orange)", fontSize: "0.75rem", marginLeft: 6 }}>
                                                                        📝 {item.notes}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`badge badge-${o.status.toLowerCase()}`}>
                                                        {o.status}
                                                    </span>
                                                </td>
                                                <td style={{ fontWeight: 800, color: "var(--green)", whiteSpace: "nowrap" }}>
                                                    ₹{Number(o.total).toFixed(2)}
                                                </td>
                                                <td className="text-muted" style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                                                    {dt
                                                        ? `${dt.toLocaleDateString("en-IN", {
                                                              day: "2-digit",
                                                              month: "short",
                                                              year: "numeric",
                                                          })} · ${dt.toLocaleTimeString([], {
                                                              hour: "2-digit",
                                                              minute: "2-digit",
                                                          })}`
                                                        : "—"}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
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
                    <button className="btn btn-outline btn-sm" onClick={() => fetchOrders()}>Refresh</button>
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


            <div
                className="kanban"
                style={{
                    gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(0, 1fr))`,
                }}
            >
                {visibleColumns.map((col) => {
                    const colOrders = orders.filter((o) => {
                        if (o.status !== col.status) return false;
                        if (col.status === "SERVED") {
                            return matchesServedFilter(o.created_at);
                        }
                        return true;
                    });
                    return (
                        <div key={col.status} className="kanban-col">
                            <div
                                className="kanban-col-header"
                                style={{
                                    flexDirection: col.status === "SERVED" ? "column" : "row",
                                    alignItems: col.status === "SERVED" ? "stretch" : "center",
                                    gap: col.status === "SERVED" ? 8 : 0,
                                }}
                            >
                                <div className="flex items-center justify-between" style={{ width: "100%" }}>
                                    <span style={{ color: col.color }}>
                                        {col.status === "SERVED"
                                            ? servedFilterMode === "all"
                                                ? "🍽️ Served (All)"
                                                : servedFilterMode === "date"
                                                ? `🍽️ Served (${servedFilterDate})`
                                                : "🍽️ Served (Today)"
                                            : col.label}
                                    </span>
                                    <span style={{ background: col.color, color: "#0f0f1a", borderRadius: "999px", padding: "1px 8px", fontSize: "0.75rem", fontWeight: 700 }}>
                                        {colOrders.length}
                                    </span>
                                </div>
                                {col.status === "SERVED" && (
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 4,
                                            flexWrap: "wrap",
                                            paddingTop: 4,
                                            borderTop: "1px solid rgba(255,255,255,0.06)",
                                        }}
                                    >
                                        <button
                                            type="button"
                                            className="btn btn-sm"
                                            style={{
                                                padding: "3px 8px",
                                                fontSize: "0.7rem",
                                                borderRadius: 6,
                                                background: servedFilterMode === "today" ? "var(--accent)" : "rgba(255,255,255,0.06)",
                                                color: servedFilterMode === "today" ? "#fff" : "var(--text-muted)",
                                            }}
                                            onClick={() => setServedFilterMode("today")}
                                        >
                                            Today
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-sm"
                                            style={{
                                                padding: "3px 8px",
                                                fontSize: "0.7rem",
                                                borderRadius: 6,
                                                background: servedFilterMode === "all" ? "var(--accent)" : "rgba(255,255,255,0.06)",
                                                color: servedFilterMode === "all" ? "#fff" : "var(--text-muted)",
                                            }}
                                            onClick={() => setServedFilterMode("all")}
                                        >
                                            All
                                        </button>
                                        <input
                                            type="date"
                                            value={servedFilterDate}
                                            max={todayDateStr}
                                            onChange={(e) => {
                                                setServedFilterDate(e.target.value);
                                                setServedFilterMode("date");
                                            }}
                                            style={{
                                                flex: 1,
                                                minWidth: 110,
                                                padding: "2px 6px",
                                                fontSize: "0.7rem",
                                                borderRadius: 6,
                                                background: servedFilterMode === "date" ? "rgba(108,99,255,0.2)" : "var(--bg-base)",
                                                border: servedFilterMode === "date" ? "1px solid var(--accent)" : "1px solid var(--border)",
                                                color: "var(--text)",
                                                colorScheme: "dark",
                                            }}
                                            title="Filter served orders by date"
                                        />
                                    </div>
                                )}
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
