import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

export default function Login() {
    const navigate = useNavigate();
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams();
            params.append("username", phone.trim());
            params.append("password", password);
            const res = await api.post("/auth/login", params);
            localStorage.setItem("hd_token", res.data.access_token);
            localStorage.setItem("hd_staff", JSON.stringify(res.data));

            if (res.data.role === "SYSTEM_ADMIN") {
                navigate("/system");
            } else {
                navigate("/orders");
            }
        } catch {
            setError("Invalid phone or PIN. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="login-wrap">
            <div className="card login-card">
                <div className="login-logo">🍽️ HelloDine</div>
                <p className="login-sub" style={{ color: "var(--primary)", fontWeight: "bold" }}>v2.0-NUCLEAR (LINKED TO RENDER)</p>
                <p className="login-sub">Kitchen & Cashier Dashboard</p>

                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label className="input-label">Login ID / Mobile Number / Username</label>
                        <input
                            id="phone"
                            className="input"
                            type="text"
                            placeholder="e.g. 9000000001 or ravi_cashier or sysadmin"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            required
                        />
                    </div>
                    <div className="input-group">
                        <label className="input-label">Password / PIN</label>
                        <input
                            id="password"
                            className="input"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {error && (
                        <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: "12px" }}>{error}</p>
                    )}

                    <button id="login-btn" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "12px" }} disabled={loading}>
                        {loading ? "Signing in…" : "Sign In →"}
                    </button>
                </form>

                <p className="text-muted text-sm" style={{ marginTop: "20px", textAlign: "center" }}>
                    Powered by HelloDine v2.0
                </p>

                <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: "1px solid var(--border)", textAlign: "center" }}>
                    <a
                        href="/kiosk"
                        className="btn btn-outline"
                        style={{ width: "100%", justifyContent: "center", textDecoration: "none", color: "var(--green)", borderColor: "var(--green)" }}
                    >
                        📱 Open Customer Table Kiosk UI →
                    </a>
                </div>

            </div>
        </div>
    );
}
