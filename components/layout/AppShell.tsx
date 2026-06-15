import type { ReactNode } from "react";
import Navbar from "./Navbar";
import AppSidebar from "./AppSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./Sidebar";

export default function AppShell({ children }: { children: ReactNode }) {
    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="min-h-svh bg-zinc-50 dark:bg-black">
                <Navbar showAuthLinks={false} ctaHref="/recommendation" ctaLabel="New recommendation" />
                <div className="border-b border-border bg-background/80 px-4 py-2 backdrop-blur md:hidden">
                    <SidebarTrigger aria-label="Open app navigation" />
                </div>
                <main className="flex-1 p-4 md:p-8">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    );
}