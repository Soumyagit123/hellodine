import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import OrdersBoard from "./pages/OrdersBoard";
import Billing from "./pages/Billing";
import MenuAdmin from "./pages/admin/MenuAdmin";
import TablesAdmin from "./pages/admin/TablesAdmin";
import StaffAdmin from "./pages/admin/StaffAdmin";
import DailyReport from "./pages/admin/DailyReport";
import BranchAdmin from "./pages/admin/BranchAdmin";
import SystemAdmin from "./pages/admin/SystemAdmin";
import TableKiosk from "./pages/kiosk/TableKiosk";
import client from "./api/client";


function isLoggedIn() {
    return !!localStorage.getItem("hd_token");
}

function getRole() {
    try {
        const s = JSON.parse(localStorage.getItem("hd_staff") || "{}");
        return s.role || "";
    } catch {
        return "";
    }
}

function getDefaultHomePath(role: string) {
    if (role === "SYSTEM_ADMIN") return "/system";
    return "/orders";
}

function RequireRole({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactElement }) {
    const role = getRole();
    if (!role) return <Navigate to="/login" replace />;
    if (!allowedRoles.includes(role)) {
        return <Navigate to={getDefaultHomePath(role)} replace />;
    }
    return children;
}

function BranchSelector() {
    const [branches, setBranches] = useState<any[]>([]);
    const [selected, setSelected] = useState(localStorage.getItem("hd_selected_branch") || "");
    const navigate = useNavigate();

    const staff = JSON.parse(localStorage.getItem("hd_staff") || "{}");
    const restaurantId = staff.restaurant_id;

    useEffect(() => {
        if (restaurantId) {
            client.get(`/admin/branches?restaurant_id=${restaurantId}`).then(r => {
                setBranches(r.data);
                if (!localStorage.getItem("hd_selected_branch") && r.data.length > 0) {
                    localStorage.setItem("hd_selected_branch", r.data[0].id);
                    localStorage.setItem("hd_selected_branch_name", r.data[0].name);
                    setSelected(r.data[0].id);
                }
            });
        }
    }, [restaurantId]);

    const handleBranchChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value;
        const b = branches.find(x => x.id === id);
        if (b) {
            localStorage.setItem("hd_selected_branch", b.id);
            localStorage.setItem("hd_selected_branch_name", b.name);
            setSelected(b.id);
            // Refresh current page to apply new branch context
            window.location.reload();
        }
    };

    if (branches.length === 0) return null;

    return (
        <div style={{ padding: "0 14px", marginBottom: "16px" }}>
            <label style={{ fontSize: "0.65rem", textTransform: "uppercase", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Active Branch</label>
            <select
                className="select"
                style={{ width: "100%", fontSize: "0.8rem", padding: "6px" }}
                value={selected}
                onChange={handleBranchChange}
            >
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
        </div>
    );
}

function Sidebar({ isOpen, hideSidebar, openPasswordModal }: { isOpen: boolean; hideSidebar: () => void; openPasswordModal: () => void }) {
    const navigate = useNavigate();
    const role = getRole();
    const staff = JSON.parse(localStorage.getItem("hd_staff") || "{}");

    function logout() {
        localStorage.clear();
        navigate("/login");
    }

    return (
        <aside className={`sidebar ${isOpen ? "open" : ""}`}>
            <div className="logo" style={{ flexDirection: "column", alignItems: "flex-start", height: "auto", padding: "8px 14px 12px", marginBottom: "10px", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div className="logo-dot" />
                    <span style={{ fontSize: "1.1rem", fontWeight: 800 }}>{staff.restaurant_name || "HelloDine"}</span>
                </div>
                {staff.restaurant_name && (
                    <div style={{ fontSize: "0.65rem", color: "var(--accent)", fontWeight: 600, marginLeft: "20px", marginTop: "-2px" }}>
                        by HelloDine
                    </div>
                )}
            </div>

            <div style={{ padding: "0 14px", marginBottom: "12px", flexShrink: 0 }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>{staff.name}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{staff.role}</div>
            </div>

            {role === "SUPER_ADMIN" && <BranchSelector />}

            {role !== "SYSTEM_ADMIN" && (
                <>
                    <NavLink to="/orders" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={hideSidebar} style={{ flexShrink: 0 }}>
                        🍽️ Orders
                    </NavLink>

                    <a href="/kiosk" target="_blank" rel="noopener noreferrer" className="nav-link" onClick={hideSidebar} style={{ flexShrink: 0 }}>
                        📱 Table Kiosk UI
                    </a>
                </>
            )}


            {(role === "CASHIER" || role === "BRANCH_ADMIN" || role === "SUPER_ADMIN") && (
                <NavLink to="/billing" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={hideSidebar} style={{ flexShrink: 0 }}>
                    💰 Billing
                </NavLink>
            )}

            {(role === "BRANCH_ADMIN" || role === "SUPER_ADMIN") && (
                <>
                    <div style={{ margin: "12px 0 4px", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", padding: "0 14px", flexShrink: 0 }}>
                        Admin
                    </div>
                    <NavLink to="/admin/menu" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={hideSidebar} style={{ flexShrink: 0 }}>📋 Menu</NavLink>
                    <NavLink to="/admin/tables" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={hideSidebar} style={{ flexShrink: 0 }}>🪑 Tables</NavLink>
                    <NavLink to="/admin/staff" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={hideSidebar} style={{ flexShrink: 0 }}>👤 Staff</NavLink>
                    <NavLink to="/admin/report" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={hideSidebar} style={{ flexShrink: 0 }}>📊 Daily Report</NavLink>
                    {role === "SUPER_ADMIN" && (
                        <NavLink to="/admin/branches" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={hideSidebar} style={{ flexShrink: 0 }}>🏘️ Branches</NavLink>
                    )}
                </>
            )}

            {role === "SYSTEM_ADMIN" && (
                <>
                    <div style={{ margin: "12px 0 4px", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--accent)", padding: "0 14px", flexShrink: 0 }}>
                        Provider
                    </div>
                    <NavLink to="/system" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={hideSidebar} style={{ flexShrink: 0 }}>🌐 System Dashboard</NavLink>
                </>
            )}

            <div style={{ flex: 1, minHeight: "12px" }} />

            <button className="nav-link" onClick={() => { hideSidebar(); openPasswordModal(); }} style={{ color: "var(--orange)", flexShrink: 0 }}>
                🔐 Change Password
            </button>

            <button className="nav-link" onClick={logout} style={{ color: "var(--red)", flexShrink: 0 }}>
                🚪 Logout
            </button>
        </aside>
    );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
    const [current, setCurrent] = useState("");
    const [newPass, setNewPass] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        try {
            await client.post("/auth/change-password", {
                current_password: current,
                new_password: newPass
            });
            alert("Password changed successfully!");
            onClose();
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to change password");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: "400px" }}>
                <h2>Change Password</h2>
                <form onSubmit={handleSubmit} style={{ marginTop: "20px" }}>
                    <div className="input-group">
                        <label className="input-label">Current Password</label>
                        <input type="password" required className="input" value={current} onChange={e => setCurrent(e.target.value)} />
                    </div>
                    <div className="input-group">
                        <label className="input-label">New Password</label>
                        <input type="password" required className="input" value={newPass} onChange={e => setNewPass(e.target.value)} />
                    </div>
                    <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
                        <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={loading}>
                            {loading ? "Changing..." : "Update Password"}
                        </button>
                        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function ProtectedLayout() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);

    const staff = JSON.parse(localStorage.getItem("hd_staff") || "{}");
    const restaurantName = staff.restaurant_name || "HelloDine";

    useEffect(() => {
        document.title = `${restaurantName} | HelloDine`;
    }, [restaurantName]);

    if (!isLoggedIn()) return <Navigate to="/login" replace />;

    return (
        <div className="app-shell">
            <div className={`sidebar-overlay ${sidebarOpen ? "show" : ""}`} onClick={() => setSidebarOpen(false)} />
            <Sidebar isOpen={sidebarOpen} hideSidebar={() => setSidebarOpen(false)} openPasswordModal={() => setShowPasswordModal(true)} />
            <main className="main-content">
                <header className="mobile-header">
                    <button className="menu-btn" onClick={() => setSidebarOpen(true)}>☰</button>
                    <div className="logo-text" style={{ fontSize: "1rem" }}>
                        {JSON.parse(localStorage.getItem("hd_staff") || "{}").restaurant_name || "HelloDine"}
                    </div>
                </header>
                <Routes>
                    <Route path="/" element={<Navigate to={getDefaultHomePath(getRole())} replace />} />
                    <Route
                        path="/orders"
                        element={
                            <RequireRole allowedRoles={["KITCHEN", "CASHIER", "BRANCH_ADMIN", "SUPER_ADMIN"]}>
                                <OrdersBoard />
                            </RequireRole>
                        }
                    />
                    <Route
                        path="/billing"
                        element={
                            <RequireRole allowedRoles={["CASHIER", "BRANCH_ADMIN", "SUPER_ADMIN"]}>
                                <Billing />
                            </RequireRole>
                        }
                    />
                    <Route
                        path="/admin/menu"
                        element={
                            <RequireRole allowedRoles={["BRANCH_ADMIN", "SUPER_ADMIN"]}>
                                <MenuAdmin />
                            </RequireRole>
                        }
                    />
                    <Route
                        path="/admin/tables"
                        element={
                            <RequireRole allowedRoles={["BRANCH_ADMIN", "SUPER_ADMIN"]}>
                                <TablesAdmin />
                            </RequireRole>
                        }
                    />
                    <Route
                        path="/admin/staff"
                        element={
                            <RequireRole allowedRoles={["BRANCH_ADMIN", "SUPER_ADMIN"]}>
                                <StaffAdmin />
                            </RequireRole>
                        }
                    />
                    <Route
                        path="/admin/report"
                        element={
                            <RequireRole allowedRoles={["BRANCH_ADMIN", "SUPER_ADMIN"]}>
                                <DailyReport />
                            </RequireRole>
                        }
                    />
                    <Route
                        path="/admin/branches"
                        element={
                            <RequireRole allowedRoles={["SUPER_ADMIN"]}>
                                <BranchAdmin />
                            </RequireRole>
                        }
                    />
                    <Route
                        path="/system"
                        element={
                            <RequireRole allowedRoles={["SYSTEM_ADMIN"]}>
                                <SystemAdmin />
                            </RequireRole>
                        }
                    />
                    <Route path="*" element={<Navigate to={getDefaultHomePath(getRole())} replace />} />
                </Routes>
            </main>

            {showPasswordModal && <PasswordModal onClose={() => setShowPasswordModal(false)} />}
        </div>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/kiosk" element={<TableKiosk />} />
                <Route path="/table/:token" element={<TableKiosk />} />
                <Route path="/*" element={<ProtectedLayout />} />
            </Routes>
        </BrowserRouter>
    );
}

