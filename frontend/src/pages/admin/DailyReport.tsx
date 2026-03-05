import { useEffect, useState } from "react";
import api from "../../api/client";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from "chart.js";
import { Line } from "react-chartjs-2";

// Register Chart.js modules
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

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

type DashboardData = {
    today: Metrics;
    month: Metrics;
    all_time: Metrics;
    trend_7d: TrendData[];
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


    if (loading) return <div className="text-muted" style={{ padding: 40, textAlign: "center" }}>Aggregating Analytics…</div>;
    if (!data) return <div className="text-muted">Failed to load dashboard.</div>;

    // Chart Configuration
    const chartOptions = {
        responsive: true,
        plugins: {
            legend: { display: false },
            tooltip: {
                mode: 'index' as const,
                intersect: false,
                backgroundColor: 'rgba(28,28,30,0.9)',
                titleColor: '#fff',
                bodyColor: '#34c759',
                borderColor: '#4k4',
                borderWidth: 1,
                callbacks: {
                    label: function (context: any) {
                        let label = context.dataset.label || '';
                        if (label) label += ': ';
                        if (context.parsed.y !== null) {
                            label += new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(context.parsed.y);
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

    const chartData = {
        labels: data.trend_7d.map(t => t.date),
        datasets: [
            {
                label: 'Revenue',
                data: data.trend_7d.map(t => t.revenue),
                borderColor: '#34c759',
                backgroundColor: 'rgba(52, 199, 89, 0.1)',
                borderWidth: 3,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#34c759',
                pointHoverBackgroundColor: '#34c759',
                pointHoverBorderColor: '#fff',
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4 // Smooth curves
            }
        ]
    };

    // Helper formatter
    const fmt = (num: number) => new Intl.NumberFormat("en-IN", { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);

    return (
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div className="page-header" style={{ marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
                <div>
                    <h1 className="page-title" style={{ fontSize: "1.8rem", letterSpacing: "-0.5px" }}>Corporate Analytics</h1>
                    <p className="page-sub" style={{ fontSize: "0.95rem" }}>Executive performance dashboard and revenue trends</p>
                </div>
                <button className="btn btn-outline btn-sm" onClick={fetchDashboard}>🔄 Refresh Data</button>
            </div>

            {/* KPI ROW 1: REVENUE */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 20 }}>
                {/* TODAY */}
                <div className="card" style={{ background: "linear-gradient(145deg, rgba(44,44,46,0.6) 0%, rgba(28,28,30,0.8) 100%)", border: "1px solid rgba(52, 199, 89, 0.2)" }}>
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-muted" style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 4 }}>Today's Revenue</p>
                            <h2 style={{ fontSize: "2.4rem", fontWeight: 800, color: "var(--green)", margin: 0 }}>{fmt(data.today.total_revenue)}</h2>
                        </div>
                        <div style={{ background: "rgba(52, 199, 89, 0.1)", color: "var(--green)", padding: "6px 12px", borderRadius: 20, fontSize: "0.8rem", fontWeight: 700 }}>LIVE</div>
                    </div>
                    <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
                        <span className="text-muted" style={{ fontSize: "0.9rem" }}>Orders Completed</span>
                        <span style={{ fontWeight: 700 }}>{data.today.total_bills}</span>
                    </div>
                </div>

                {/* MTD */}
                <div className="card">
                    <p className="text-muted" style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 4 }}>Month to Date (MTD)</p>
                    <h2 style={{ fontSize: "2rem", fontWeight: 700, margin: 0 }}>{fmt(data.month.total_revenue)}</h2>
                    <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
                        <span className="text-muted" style={{ fontSize: "0.9rem" }}>Total MTD Orders</span>
                        <span style={{ fontWeight: 700 }}>{data.month.total_bills}</span>
                    </div>
                </div>

                {/* ALL TIME */}
                <div className="card">
                    <p className="text-muted" style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 4 }}>All-Time Revenue</p>
                    <h2 style={{ fontSize: "2rem", fontWeight: 700, margin: 0, color: "var(--accent)" }}>{fmt(data.all_time.total_revenue)}</h2>
                    <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
                        <span className="text-muted" style={{ fontSize: "0.9rem" }}>Lifetime Orders</span>
                        <span style={{ fontWeight: 700 }}>{data.all_time.total_bills}</span>
                    </div>
                </div>
            </div>

            {/* MAIN CHART */}
            <div className="card" style={{ padding: "24px", marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>7-Day Revenue Trend</h3>
                    <span className="text-muted text-sm">Trailing 7 days</span>
                </div>
                <div style={{ height: 320, width: "100%" }}>
                    <Line data={chartData} options={chartOptions as any} />
                </div>
            </div>

            {/* TAX BREAKDOWN */}
            <h3 style={{ marginTop: 32, marginBottom: 16, fontSize: "1.1rem" }}>Tax & Collection Breakdown</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
                <div className="card">
                    <h4 style={{ color: "var(--muted)", margin: "0 0 16px 0", fontSize: "0.95rem" }}>Today's Breakdown</h4>
                    <div className="flex justify-between text-sm mb-2"><span className="text-muted">Net Taxable Amount</span><span>{fmt(data.today.total_revenue - data.today.total_cgst - data.today.total_sgst)}</span></div>
                    <div className="flex justify-between text-sm mb-2"><span className="text-muted">CGST (9%) Collected</span><span style={{ color: "var(--blue)" }}>{fmt(data.today.total_cgst)}</span></div>
                    <div className="flex justify-between text-sm mb-2"><span className="text-muted">SGST (9%) Collected</span><span style={{ color: "var(--yellow)" }}>{fmt(data.today.total_sgst)}</span></div>
                    <div className="flex justify-between mt-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, fontWeight: 700 }}>
                        <span>Gross Collection</span><span style={{ color: "var(--green)" }}>{fmt(data.today.total_revenue)}</span>
                    </div>
                </div>

                <div className="card">
                    <h4 style={{ color: "var(--muted)", margin: "0 0 16px 0", fontSize: "0.95rem" }}>Lifetime Breakdown</h4>
                    <div className="flex justify-between text-sm mb-2"><span className="text-muted">Net Taxable Amount</span><span>{fmt(data.all_time.total_revenue - data.all_time.total_cgst - data.all_time.total_sgst)}</span></div>
                    <div className="flex justify-between text-sm mb-2"><span className="text-muted">Lifetime CGST</span><span style={{ color: "var(--blue)" }}>{fmt(data.all_time.total_cgst)}</span></div>
                    <div className="flex justify-between text-sm mb-2"><span className="text-muted">Lifetime SGST</span><span style={{ color: "var(--yellow)" }}>{fmt(data.all_time.total_sgst)}</span></div>
                    <div className="flex justify-between mt-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, fontWeight: 700 }}>
                        <span>Total Gross</span><span style={{ color: "var(--accent)" }}>{fmt(data.all_time.total_revenue)}</span>
                    </div>
                </div>
            </div>

        </div>
    );
}
