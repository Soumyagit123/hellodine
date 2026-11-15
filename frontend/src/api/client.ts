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

const api = axios.create({ 
    baseURL: API_BASE_URL,
    withCredentials: true,
});


// Ultra-fast client-side memory cache + in-flight request deduplication so switching between
// Super Admin tabs (Orders, Menu, Tables, Staff, Branches, Daily Report) renders in 0ms
// from the already-fetched Redis/API response without firing duplicate GET calls.
const _clientGetCache = new Map<string, { data: any; ts: number }>();

export function getClientCached<T = any>(url: string, maxAgeMs = 86_400_000): T | undefined {
    const entry = _clientGetCache.get(url);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > maxAgeMs) {
        _clientGetCache.delete(url);
        return undefined;
    }
    return entry.data as T;
}

export function isClientCacheFresh(url: string, freshWindowMs = 60_000): boolean {
    const entry = _clientGetCache.get(url);
    if (!entry) return false;
    return Date.now() - entry.ts <= freshWindowMs;
}

export function setClientCached(url: string, data: any): void {
    _clientGetCache.set(url, { data, ts: Date.now() });
}

export function invalidateClientCachePrefix(prefix: string): void {
    for (const key of _clientGetCache.keys()) {
        if (key.startsWith(prefix)) {
            _clientGetCache.delete(key);
        }
    }
}

export function clearClientCache(): void {
    _clientGetCache.clear();
}

// Deduplicate concurrent identical GET requests (e.g. React StrictMode double-mount)
const _inFlightGets = new Map<string, Promise<any>>();
const _origGet = api.get.bind(api);
api.get = function <T = any, R = any, D = any>(url: string, config?: any): Promise<R> {
    if (!config) {
        const existing = _inFlightGets.get(url);
        if (existing) return existing as Promise<R>;
        const p = _origGet<T, R, D>(url, config).finally(() => {
            _inFlightGets.delete(url);
        });
        _inFlightGets.set(url, p);
        return p;
    }
    return _origGet<T, R, D>(url, config);
} as typeof api.get;

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("hd_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    // Automatically invalidate client GET cache on any write request (POST/PATCH/DELETE)
    if (config.method && config.method.toLowerCase() !== "get") {
        _clientGetCache.clear();
    }
    return config;
});

api.interceptors.response.use(
    (res) => {
        if (res.config.method?.toLowerCase() === "get" && res.config.url) {
            setClientCached(res.config.url, res.data);
        }
        return res;
    },
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

