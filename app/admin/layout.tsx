import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
    try {
        await requireAdmin();
    } catch {
        redirect("/auth/login?redirect=/admin");
    }

    return children;
} 