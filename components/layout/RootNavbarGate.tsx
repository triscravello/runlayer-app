"use client";

import { usePathname } from "next/navigation";
import Navbar from "./Navbar";

const appShellPrefixes = [
    "/dashboard", 
    "/admin", 
    "/recommendation", 
    "/compare",
    "/profile",
    "/saved-outfits",
];

export default function RootNavbarGate() {
    const pathname = usePathname();
    const normalizedPathname = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    const isAppShellRoute = appShellPrefixes.some(
        (prefix) => normalizedPathname === prefix || normalizedPathname.startsWith(`${prefix}/`),
    );

    if (isAppShellRoute) {
        return null;
    }

    return <Navbar />;
}