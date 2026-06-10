import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { ForbiddenError } from "@/lib/http/apiErrors";

export default async function AdminLayout({ children }: { children: ReactNode }) {
    try {
        await requireAdmin();
    } catch (error) {
        if (error instanceof ForbiddenError) {
            redirect("/dashboard");
        }
        redirect("/auth/login?redirect=/admin");
    }

    return children;
} 