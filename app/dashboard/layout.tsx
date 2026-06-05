import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
    try {
        await requireAuth();
    } catch {
        redirect("/auth/login?redirect=/dashboard");
    }

    return children;
} 