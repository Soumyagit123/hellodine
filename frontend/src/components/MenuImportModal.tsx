import { useState } from "react";
import api from "../api/client";

interface ExtractedMenuItem {
    name: string;
    description: string;
    base_price: number | null;
    gst_percent: number;
    is_veg: boolean;
    is_bestseller: boolean;
    sub_category?: string | null;
    image_url?: string | null;
    variants: { name: string; price_delta: number }[];
    needs_review: boolean;
    review_reasons: string[];
}

interface ExtractedMenuCategory {
    name: string;
    items: ExtractedMenuItem[];
}

interface MenuManifest {
    source_filename: string;
    parser_used: string;
    categories: ExtractedMenuCategory[];
    total_items: number;
    items_needing_review: number;
}

interface MenuImportModalProps {
    branchId: string;
    onClose: () => void;
    onSuccess: () => Promise<void>;
}

export default function MenuImportModal({ branchId, onClose, onSuccess }: MenuImportModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [scanning, setScanning] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [error, setError] = useState("");
    const [manifest, setManifest] = useState<MenuManifest | null>(null);

    async function handleScan() {
        if (!file || scanning) return;
        setScanning(true);
        setError("");
        try {
            const formData = new FormData();
            formData.append("file", file);
            const res = await api.post("/menu-agent/scan", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            setManifest(res.data.manifest);
        } catch (err: any) {
            setError(err?.response?.data?.detail || "Failed to scan menu file.");
        } finally {
            setScanning(false);
        }
    }

    function updateItem(catIdx: number, itemIdx: number, patch: Partial<ExtractedMenuItem>) {
        if (!manifest) return;
        const nextCategories = manifest.categories.map((cat, ci) => {
            if (ci !== catIdx) return cat;
            return {
                ...cat,
                items: cat.items.map((item, ii) => {
                    if (ii !== itemIdx) return item;
                    const updated = { ...item, ...patch };
                    const hasValidName = Boolean(updated.name && updated.name.trim());
                    const hasValidPrice = updated.base_price !== null && !Number.isNaN(updated.base_price) && updated.base_price >= 0;
                    updated.needs_review = !(hasValidName && hasValidPrice);
                    updated.review_reasons = [];
                    if (!hasValidName) updated.review_reasons.push("Missing dish name");
                    if (!hasValidPrice) updated.review_reasons.push("Missing or invalid price");
                    return updated;
                }),
            };
        });
        const itemsNeedingReview = nextCategories.reduce(
            (sum, c) => sum + c.items.filter((i) => i.needs_review).length,
            0
        );
        setManifest({
            ...manifest,
            categories: nextCategories,
            items_needing_review: itemsNeedingReview,
        });
    }

    function removeItem(catIdx: number, itemIdx: number) {
        if (!manifest) return;
        const nextCategories = manifest.categories
            .map((cat, ci) => (ci !== catIdx ? cat : { ...cat, items: cat.items.filter((_, ii) => ii !== itemIdx) }))
            .filter((cat) => cat.items.length > 0);
        const totalItems = nextCategories.reduce((sum, c) => sum + c.items.length, 0);
        const itemsNeedingReview = nextCategories.reduce(
            (sum, c) => sum + c.items.filter((i) => i.needs_review).length,
            0
        );
        setManifest({
            ...manifest,
            categories: nextCategories,
            total_items: totalItems,
            items_needing_review: itemsNeedingReview,
        });
    }

    async function handleCommit() {
        if (!manifest || committing) return;
        setCommitting(true);
        setError("");
        try {
            await api.post("/menu-agent/commit", {
                branch_id: branchId,
                manifest,
            });
            await onSuccess();
            onClose();
        } catch (err: any) {
            setError(err?.response?.data?.detail || "Failed to save menu to database.");
        } finally {
            setCommitting(false);
        }
    }

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1000,
                background: "rgba(0, 0, 0, 0.72)",
                backdropFilter: "blur(4px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: "#131722",
                    border: "1px solid #2a3142",
                    borderRadius: 16,
                    padding: 24,
                    color: "#f1f5f9",
                    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.65)",
                    maxWidth: manifest ? 1020 : 540,
                    width: "95%",
                    maxHeight: "90vh",
                    overflowY: "auto",
                }}
            >
                <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
                    <div>
                        <h3 style={{ margin: 0 }}>AI Menu Scanner &amp; Importer</h3>
                        <p className="text-muted text-sm" style={{ margin: "4px 0 0" }}>
                            Upload Excel, CSV, PDF, or Menu Card Image. Review flagged items before saving.
                        </p>
                    </div>
                    <button className="btn btn-sm" onClick={onClose} disabled={scanning || committing}>
                        ✕
                    </button>
                </div>

                {error && (
                    <div
                        style={{
                            background: "#fee2e2",
                            color: "#991b1b",
                            padding: "10px 12px",
                            borderRadius: 8,
                            marginBottom: 14,
                            fontSize: 13,
                        }}
                    >
                        {error}
                    </div>
                )}

                {!manifest ? (
                    <div>
                        <div
                            style={{
                                border: "2px dashed #cbd5e1",
                                borderRadius: 12,
                                padding: 24,
                                textAlign: "center",
                                marginBottom: 16,
                            }}
                        >
                            <input
                                type="file"
                                accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp"
                                onChange={(e) => setFile(e.target.files?.[0] || null)}
                            />
                            {file && (
                                <p className="text-sm" style={{ marginTop: 10, fontWeight: 600 }}>
                                    Selected: {file.name} ({Math.round(file.size / 1024)} KB)
                                </p>
                            )}
                        </div>
                        <div className="flex justify-end gap-2">
                            <button className="btn btn-sm" onClick={onClose} disabled={scanning}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={handleScan}
                                disabled={!file || scanning}
                            >
                                {scanning ? "Scanning..." : "Scan Menu"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div>
                        <div
                            className="flex justify-between items-center"
                            style={{
                                background: manifest.items_needing_review > 0 ? "#fef3c7" : "#dcfce7",
                                color: manifest.items_needing_review > 0 ? "#92400e" : "#166534",
                                padding: "10px 14px",
                                borderRadius: 8,
                                marginBottom: 14,
                                fontSize: 13,
                                fontWeight: 600,
                            }}
                        >
                            <span>
                                Extracted {manifest.total_items} items across {manifest.categories.length} categories
                                {" · "}Parser: {manifest.parser_used}
                            </span>
                            <span>
                                {manifest.items_needing_review > 0
                                    ? `${manifest.items_needing_review} item(s) need review`
                                    : "All items ready"}
                            </span>
                        </div>

                        {manifest.categories.map((cat, catIdx) => (
                            <div key={`${cat.name}-${catIdx}`} style={{ marginBottom: 18 }}>
                                <h4 style={{ margin: "0 0 8px", fontSize: 15 }}>{cat.name}</h4>
                                <div style={{ overflowX: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                        <thead>
                                            <tr style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
                                                <th style={{ padding: "6px 8px" }}>Name</th>
                                                <th style={{ padding: "6px 8px", width: 100 }}>Price (₹)</th>
                                                <th style={{ padding: "6px 8px", width: 80 }}>GST %</th>
                                                <th style={{ padding: "6px 8px", width: 60 }}>Veg</th>
                                                <th style={{ padding: "6px 8px", width: 180 }}>Image URL</th>
                                                <th style={{ padding: "6px 8px" }}>Status</th>
                                                <th style={{ padding: "6px 8px", width: 60 }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {cat.items.map((item, itemIdx) => (
                                                <tr
                                                    key={itemIdx}
                                                    style={{
                                                        borderBottom: "1px solid #f1f5f9",
                                                        background: item.needs_review ? "#fffbeb" : "transparent",
                                                    }}
                                                >
                                                    <td style={{ padding: "6px 8px" }}>
                                                        <input
                                                            className="input"
                                                            style={{ width: "100%", padding: "4px 8px", fontSize: 13 }}
                                                            value={item.name}
                                                            onChange={(e) =>
                                                                updateItem(catIdx, itemIdx, { name: e.target.value })
                                                            }
                                                        />
                                                    </td>
                                                    <td style={{ padding: "6px 8px" }}>
                                                        <input
                                                            type="number"
                                                            className="input"
                                                            style={{ width: "100%", padding: "4px 8px", fontSize: 13 }}
                                                            value={item.base_price ?? ""}
                                                            onChange={(e) =>
                                                                updateItem(catIdx, itemIdx, {
                                                                    base_price:
                                                                        e.target.value === ""
                                                                            ? null
                                                                            : Number(e.target.value),
                                                                })
                                                            }
                                                        />
                                                    </td>
                                                    <td style={{ padding: "6px 8px" }}>
                                                        <input
                                                            type="number"
                                                            className="input"
                                                            style={{ width: "100%", padding: "4px 8px", fontSize: 13 }}
                                                            value={item.gst_percent}
                                                            onChange={(e) =>
                                                                updateItem(catIdx, itemIdx, {
                                                                    gst_percent: Number(e.target.value) || 0,
                                                                })
                                                            }
                                                        />
                                                    </td>
                                                    <td style={{ padding: "6px 8px", textAlign: "center" }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={item.is_veg}
                                                            onChange={(e) =>
                                                                updateItem(catIdx, itemIdx, { is_veg: e.target.checked })
                                                            }
                                                        />
                                                    </td>
                                                    <td style={{ padding: "6px 8px" }}>
                                                        <input
                                                            className="input"
                                                            placeholder="https://..."
                                                            style={{ width: "100%", padding: "4px 8px", fontSize: 12 }}
                                                            value={item.image_url ?? ""}
                                                            onChange={(e) =>
                                                                updateItem(catIdx, itemIdx, {
                                                                    image_url: e.target.value || null,
                                                                })
                                                            }
                                                        />
                                                    </td>
                                                    <td style={{ padding: "6px 8px", fontSize: 12 }}>
                                                        {item.needs_review ? (
                                                            <span style={{ color: "#b45309", fontWeight: 600 }}>
                                                                {item.review_reasons.join(", ")}
                                                            </span>
                                                        ) : (
                                                            <span style={{ color: "#15803d" }}>OK</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: "6px 8px" }}>
                                                        <button
                                                            className="btn btn-sm"
                                                            onClick={() => removeItem(catIdx, itemIdx)}
                                                            title="Remove item"
                                                        >
                                                            🗑
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}

                        <div className="flex justify-end gap-2" style={{ marginTop: 16 }}>
                            <button
                                className="btn btn-sm"
                                onClick={() => setManifest(null)}
                                disabled={committing}
                            >
                                Re-upload
                            </button>
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={handleCommit}
                                disabled={committing || manifest.items_needing_review > 0 || manifest.total_items === 0}
                            >
                                {committing ? "Saving..." : "Approve & Save to Menu"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
