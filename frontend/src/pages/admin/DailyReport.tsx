import { useEffect, useState } from "react";
import api from "../../api/client";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
    Legend,
    Filler,
    ArcElement,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

// Register Chart.js modules
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

type Metrics = {
    total_bills: number;
    total_revenue: number;
    total_cgst: number;
    total_sgst: number;
};

type TrendData = {
    date: string;
    revenue: number;
    orders: number;
};

type MonthlyTrendData = {
    month: string;
    revenue: number;
    orders: number;
};

type TopSellingItem = {
    name: string;
    quantity_sold: number;
    revenue_generated: number;
};

type PaymentBreakdown = {
    method: string;
    amount: number;
    count: number;
};

type DashboardData = {
    today: Metrics;
    month: Metrics;
    all_time: Metrics;
    aov?: {
        today: number;
        lifetime: number;
    };
    trend_7d: TrendData[];
    monthly_trend?: MonthlyTrendData[];
    top_selling_items?: TopSellingItem[];
    payment_breakdown?: PaymentBreakdown[];
};

export default function DailyReport() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [branchId, setBranchId] = useState<string>("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const s = JSON.parse(localStorage.getItem("hd_staff") || "{}");
        const selectedBranchId = localStorage.getItem("hd_selected_branch");

        if (s.branch_id) {
            setBranchId(s.branch_id);
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

    async function fetchDashboard() {
        if (!branchId) return;
        setLoading(true);
        try {
            const r = await api.get(`/billing/report/dashboard?branch_id=${branchId}`);
            setData(r.data);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (branchId) fetchDashboard();
    }, [branchId]);


    const [trendView, setTrendView] = useState<"7d" | "monthly">("7d");

    if (loading) return <div className="text-muted" style={{ padding: 40, textAlign: "center" }}>Aggregating Analytics…</div>;
    if (!data) return <div className="text-muted">Failed to load dashboard.</div>;

    // Helper formatter
    const fmt = (num: number) => new Intl.NumberFormat("en-IN", { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);

    // 7-Day Chart Configuration
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                mode: 'index' as const,
                intersect: false,
                backgroundColor: 'rgba(28,28,30,0.95)',
                titleColor: '#fff',
                bodyColor: '#23d18b',
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 1,
                callbacks: {
                    label: function (context: any) {
                        let label = context.dataset.label || '';
                        if (label) label += ': ';
                        if (context.parsed.y !== null) {
                            label += fmt(context.parsed.y);
                        }
                        return label;
                    }
                }
            },
        },
        scales: {
            x: { grid: { display: false, color: 'rgba(255,255,255,0.05)' } },
            y: {
                grid: { color: 'rgba(255,255,255,0.05)' },
                beginAtZero: true
            }
        },
        interaction: { mode: 'nearest' as const, axis: 'x' as const, intersect: false },
    };

    const chart7dData = {
        labels: data.trend_7d.map(t => t.date),
        datasets: [
            {
                label: 'Revenue',
                data: data.trend_7d.map(t => t.revenue),
                borderColor: '#23d18b',
                backgroundColor: 'rgba(35, 209, 139, 0.12)',
                borderWidth: 3,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#23d18b',
                pointHoverBackgroundColor: '#23d18b',
                pointHoverBorderColor: '#fff',
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4
            }
        ]
    };

    const chartMonthlyData = {
        labels: (data.monthly_trend || []).map(t => t.month),
        datasets: [
            {
                label: 'Monthly Revenue',
                data: (data.monthly_trend || []).map(t => t.revenue),
                backgroundColor: 'rgba(108, 99, 255, 0.65)',
                borderColor: '#6c63ff',
                borderWidth: 2,
                borderRadius: 6,
            }
        ]
    };

    return (
        <div style={{ maxWidth: 1400, margin: "0 auto", paddingBottom: 24 }}>
            {/* TOP HEADER */}
            <div className="page-header" style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                <div>
                    <h1 className="page-title" style={{ fontSize: "1.6rem", letterSpacing: "-0.5px" }}>Restaurant Analytics</h1>
                    <p className="page-sub" style={{ fontSize: "0.88rem" }}>Sales performance, customer ordering trends & revenue insights</p>
                </div>
                <button className="btn btn-outline btn-sm" onClick={fetchDashboard}>🔄 Refresh Data</button>
            </div>

            {/* KPI ROW 1: PRIMARY 4 TILES */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 16 }}>
                {/* TODAY */}
                <div className="card" style={{ padding: "14px 18px", background: "linear-gradient(145deg, rgba(44,44,46,0.6) 0%, rgba(28,28,30,0.8) 100%)", border: "1px solid rgba(35, 209, 139, 0.25)" }}>
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 2 }}>Today's Revenue</p>
                            <h2 style={{ fontSize: "1.9rem", fontWeight: 800, color: "var(--green)", margin: 0 }}>{fmt(data.today.total_revenue)}</h2>
                        </div>
                        <div style={{ background: "rgba(35, 209, 139, 0.15)", color: "var(--green)", padding: "3px 8px", borderRadius: 20, fontSize: "0.7rem", fontWeight: 700 }}>LIVE</div>
                    </div>
                    <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                        <span className="text-muted" style={{ fontSize: "0.8rem" }}>Orders Completed</span>
                        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{data.today.total_bills}</span>
                    </div>
                </div>

                {/* MTD */}
                <div className="card" style={{ padding: "14px 18px" }}>
                    <p className="text-muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 2 }}>Month to Date (MTD)</p>
                    <h2 style={{ fontSize: "1.8rem", fontWeight: 700, margin: 0 }}>{fmt(data.month.total_revenue)}</h2>
                    <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                        <span className="text-muted" style={{ fontSize: "0.8rem" }}>Total MTD Orders</span>
                        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{data.month.total_bills}</span>
                    </div>
                </div>

                {/* ALL TIME */}
                <div className="card" style={{ padding: "14px 18px" }}>
                    <p className="text-muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 2 }}>All-Time Revenue</p>
                    <h2 style={{ fontSize: "1.8rem", fontWeight: 700, margin: 0, color: "var(--accent)" }}>{fmt(data.all_time.total_revenue)}</h2>
                    <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                        <span className="text-muted" style={{ fontSize: "0.8rem" }}>Lifetime Orders</span>
                        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{data.all_time.total_bills}</span>
                    </div>
                </div>

                {/* AVERAGE ORDER VALUE (AOV) */}
                <div className="card" style={{ padding: "14px 18px" }}>
                    <p className="text-muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 2 }}>Avg Order Value (AOV)</p>
                    <h2 style={{ fontSize: "1.8rem", fontWeight: 700, margin: 0, color: "var(--yellow)" }}>{fmt(data.aov?.today || 0)}</h2>
                    <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                        <span className="text-muted" style={{ fontSize: "0.8rem" }}>Lifetime Avg</span>
                        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{fmt(data.aov?.lifetime || 0)}</span>
                    </div>
                </div>
            </div>

            {/* MAIN DASHBOARD GRID: 2 COLUMNS (LEFT: TREND CHART, RIGHT: TAX & COLLECTION BREAKDOWN) */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(320px, 1fr)", gap: 16, marginBottom: 16 }}>
                {/* LEFT: REVENUE TREND (7-DAY OR MONTHLY) */}
                <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                        <div>
                            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
                                {trendView === "7d" ? "📈 7-Day Revenue Trend" : "📊 Monthly Revenue Trend"}
                            </h3>
                            <span className="text-muted" style={{ fontSize: "0.78rem" }}>
                                {trendView === "7d" ? "Daily volume and collection flow" : "6-month historical revenue trajectory"}
                            </span>
                        </div>
                        <div className="flex gap-1" style={{ background: "rgba(255,255,255,0.05)", padding: 3, borderRadius: 6 }}>
                            <button 
                                className={`btn btn-sm ${trendView === "7d" ? "btn-primary" : "btn-outline"}`}
                                style={{ border: "none", padding: "4px 10px", fontSize: "0.75rem" }}
                                onClick={() => setTrendView("7d")}
                            >
                                7 Days
                            </button>
                            <button 
                                className={`btn btn-sm ${trendView === "monthly" ? "btn-primary" : "btn-outline"}`}
                                style={{ border: "none", padding: "4px 10px", fontSize: "0.75rem" }}
                                onClick={() => setTrendView("monthly")}
                            >
                                Monthly
                            </button>
                        </div>
                    </div>
                    <div style={{ flex: 1, minHeight: 280, width: "100%" }}>
                        {trendView === "7d" ? (
                            <Line data={chart7dData} options={chartOptions as any} />
                        ) : (
                            <Bar data={chartMonthlyData} options={chartOptions as any} />
                        )}
                    </div>
                </div>

                {/* RIGHT: TAX & GST COLLECTION BREAKDOWN (COMPACT DUAL BOX) */}
                <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div className="flex justify-between items-center mb-2">
                        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>🧾 Tax & GST Breakdown</h3>
                        <span className="text-xs text-muted">Statutory Summary</span>
                    </div>

                    {/* Today Tax Box */}
                    <div style={{ background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderRadius: 8, marginBottom: 10 }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--green)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                            <span>TODAY'S TAX</span>
                            <span>{fmt(data.today.total_revenue)} Gross</span>
                        </div>
                        <div className="flex justify-between text-xs mb-1"><span className="text-muted">Net Taxable</span><span>{fmt(data.today.total_revenue - data.today.total_cgst - data.today.total_sgst)}</span></div>
                        <div className="flex justify-between text-xs mb-1"><span className="text-muted">CGST (9%)</span><span style={{ color: "var(--blue)" }}>{fmt(data.today.total_cgst)}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-muted">SGST (9%)</span><span style={{ color: "var(--yellow)" }}>{fmt(data.today.total_sgst)}</span></div>
                    </div>

                    {/* Lifetime Tax Box */}
                    <div style={{ background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderRadius: 8 }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--accent)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                            <span>LIFETIME TAX</span>
                            <span>{fmt(data.all_time.total_revenue)} Gross</span>
                        </div>
                        <div className="flex justify-between text-xs mb-1"><span className="text-muted">Net Taxable</span><span>{fmt(data.all_time.total_revenue - data.all_time.total_cgst - data.all_time.total_sgst)}</span></div>
                        <div className="flex justify-between text-xs mb-1"><span className="text-muted">Lifetime CGST</span><span style={{ color: "var(--blue)" }}>{fmt(data.all_time.total_cgst)}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-muted">Lifetime SGST</span><span style={{ color: "var(--yellow)" }}>{fmt(data.all_time.total_sgst)}</span></div>
                    </div>
                </div>
            </div>

            {/* ROW 3: DUAL INSIGHTS (LEFT: TOP 5 BEST SELLERS, RIGHT: PAYMENT CHANNELS) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
                {/* TOP 5 BEST SELLERS */}
                <div className="card" style={{ padding: "18px 20px" }}>
                    <div className="flex justify-between items-center mb-2">
                        <div>
                            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>🏆 Top 5 Best Selling Items</h3>
                            <span className="text-xs text-muted">Ranked by most quantity ordered</span>
                        </div>
                        <span className="badge badge-primary" style={{ fontSize: "0.7rem", padding: "2px 8px" }}>Most Popular</span>
                    </div>
                    {(!data.top_selling_items || data.top_selling_items.length === 0) ? (
                        <div className="text-muted text-sm" style={{ padding: "20px 0", textAlign: "center" }}>No sales recorded yet</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                            {data.top_selling_items.map((item, idx) => (
                                <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)" }}>
                                    <div className="flex items-center gap-3">
                                        <span style={{ 
                                            width: 24, 
                                            height: 24, 
                                            borderRadius: "50%", 
                                            background: idx === 0 ? "rgba(249, 202, 36, 0.2)" : "rgba(255,255,255,0.08)",
                                            color: idx === 0 ? "var(--yellow)" : "var(--text)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontWeight: 800,
                                            fontSize: "0.75rem"
                                        }}>
                                            #{idx + 1}
                                        </span>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: "0.92rem", color: "var(--text)" }}>{item.name}</div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span style={{ 
                                                    background: "rgba(108, 99, 255, 0.15)", 
                                                    color: "var(--accent)", 
                                                    padding: "1px 6px", 
                                                    borderRadius: 4, 
                                                    fontSize: "0.72rem", 
                                                    fontWeight: 700 
                                                }}>
                                                    {item.quantity_sold} {item.quantity_sold === 1 ? 'item sold' : 'items sold'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                        <div style={{ fontWeight: 800, color: "var(--green)", fontSize: "0.95rem" }}>
                                            {fmt(item.revenue_generated)}
                                        </div>
                                        <span className="text-xs text-muted">revenue</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* PAYMENT METHODS BREAKDOWN */}
                <div className="card" style={{ padding: "18px 20px" }}>
                    <div className="flex justify-between items-center mb-2">
                        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>💳 Payment Settlement Channels</h3>
                        <span className="text-xs text-muted">Share of Revenue</span>
                    </div>
                    {(!data.payment_breakdown || data.payment_breakdown.length === 0) ? (
                        <div className="text-muted text-sm" style={{ padding: "20px 0", textAlign: "center" }}>No payment transactions recorded</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {data.payment_breakdown.map((pm, idx) => {
                                const totalCollected = data.payment_breakdown!.reduce((sum, p) => sum + p.amount, 0);
                                const pct = totalCollected > 0 ? Math.round((pm.amount / totalCollected) * 100) : 0;
                                const methodColors: Record<string, string> = {
                                    UPI: "var(--green)",
                                    CASH: "var(--yellow)",
                                    CARD: "var(--blue)"
                                };
                                const color = methodColors[pm.method] || "var(--accent)";

                                return (
                                    <div key={idx} style={{ padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                                                <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{pm.method}</span>
                                                <span className="text-xs text-muted">({pm.count} bills)</span>
                                            </div>
                                            <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{fmt(pm.amount)} ({pct}%)</div>
                                        </div>
                                        <div style={{ height: 5, width: "100%", background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden", marginTop: 6 }}>
                                            <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999, transition: "width 0.4s ease" }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
}
