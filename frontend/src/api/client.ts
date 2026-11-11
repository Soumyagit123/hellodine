import axios from "axios";

const defaultApiUrl =
    typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
        ? `http://${window.location.hostname || "127.0.0.1"}:8000/api`
        : "https://hellodine-api.onrender.com/api";

const rawEnvUrl = import.meta.env.VITE_API_URL ? String(import.meta.env.VITE_API_URL).replace(/\/+$/, "") : "";
export const API_BASE_URL = rawEnvUrl
    ? rawEnvUrl.endsWith("/api")
        ? rawEnvUrl
        : `${rawEnvUrl}/api`
    : defaultApiUrl;

export const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws");

const api = axios.create({ baseURL: API_BASE_URL });


api.interceptors.request.use((config) => {
    const token = localStorage.getItem("hd_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

api.interceptors.response.use(
    (res) => res,
    (err) => {
        if (err.response?.status === 401 && !window.location.pathname.startsWith("/table") && !window.location.pathname.startsWith("/kiosk")) {
            localStorage.removeItem("hd_token");
            localStorage.removeItem("hd_staff");
            window.location.href = "/login";
        }
        return Promise.reject(err);
    }
);

export default api;

