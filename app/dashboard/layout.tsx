import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireAuth } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
    try {
        await requireAuth();
    } catch {
        redirect("/login?redirect=/dashboard");
    }

    return <AppShell>{children}</AppShell>;
} 