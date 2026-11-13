import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import client from "../api/client";

export interface Branch {
    id: string;
    name: string;
    address?: string;
    restaurant_id?: string;
}

interface BranchContextType {
    branches: Branch[];
    selectedBranchId: string;
    selectedBranchName: string;
    setSelectedBranch: (branchId: string) => void;
    refreshBranches: () => Promise<void>;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string>(() => {
        return localStorage.getItem("hd_selected_branch") || "";
    });
    const [selectedBranchName, setSelectedBranchName] = useState<string>(() => {
        return localStorage.getItem("hd_selected_branch_name") || "";
    });

    const staffRaw = localStorage.getItem("hd_staff");
    const staff = staffRaw ? JSON.parse(staffRaw) : null;
    const restaurantId = staff?.restaurant_id;

    const refreshBranches = async () => {
        if (!restaurantId) return;
        try {
            const res = await client.get(`/admin/branches?restaurant_id=${restaurantId}`);
            const data: Branch[] = res.data;
            setBranches(data);

            if (data.length > 0) {
                const currentExists = data.some(b => b.id === selectedBranchId);
                if (!selectedBranchId || !currentExists) {
                    const first = data[0];
                    setSelectedBranchId(first.id);
                    setSelectedBranchName(first.name);
                    localStorage.setItem("hd_selected_branch", first.id);
                    localStorage.setItem("hd_selected_branch_name", first.name);
                }
            }
        } catch (err) {
            console.error("Failed to fetch branches:", err);
        }
    };

    useEffect(() => {
        refreshBranches();
    }, [restaurantId]);

    const setSelectedBranch = (branchId: string) => {
        const found = branches.find(b => b.id === branchId);
        if (found) {
            setSelectedBranchId(found.id);
            setSelectedBranchName(found.name);
            localStorage.setItem("hd_selected_branch", found.id);
            localStorage.setItem("hd_selected_branch_name", found.name);
        }
    };

    return (
        <BranchContext.Provider
            value={{
                branches,
                selectedBranchId,
                selectedBranchName,
                setSelectedBranch,
                refreshBranches,
            }}
        >
            {children}
        </BranchContext.Provider>
    );
}

export function useBranch() {
    const ctx = useContext(BranchContext);
    if (!ctx) {
        throw new Error("useBranch must be used within a BranchProvider");
    }
    return ctx;
}
