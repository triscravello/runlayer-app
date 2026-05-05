"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Zap } from "lucide-react";
import { clsx, type ClassValue} from "clsx";
import { twMerge } from "tailwind-merge";
import * as React from "react";
import { Button } from "../ui/Button";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

type NavItem = {
    href: string;
    label: string;
};

const navItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/recommendation", label: "Recommendation" },
    { href: "/dashboard/profile", label: "Profile" },
    { href: "/dashboard/saved-outfits", label: "Saved Outfits" }
];

type NavbarProps = {
    ctaHref?: string;
    ctaLabel?: string;
    showAuthLinks?: boolean;
};

export default function Navbar({
    ctaHref = "/auth/signup",
    ctaLabel = "Get Started",
    showAuthLinks = true,
}: NavbarProps) {
    const pathname = usePathname();
    const [isMenuOpen, setIsMenuOpen] = React.useState(false);

    const isActive = React.useCallback(
        (href: string) => pathname === href || pathname.startsWith(`${href}/`),
        [pathname],
    );

    const closeMenu = () => setIsMenuOpen(false);

    return (
        <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-xl supports-[backdrop-filter]:bg-card/70">
            <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
                <Link 
                    href="/"
                    className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visilble:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={closeMenu}
                    aria-label="RunLayer home"
                >
                    <span className="flex size-9 items-center justify-center rounded-xlbg-[#10B981] text-white shadow-sm shadow-emerald-500/20">
                        <Zap className="size-5" aria-hidden="true" />
                    </span>
                    <span className="text-xl font-medium tracking-tight">RunLayer</span>
                </Link>

                <nav aria-label="Primary navigation" className="hidden items-center gap-1 md:flex">
                    {navItems.map((item) => (
                        <Link 
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                isActive(item.href) ? "bg-[#10B981]/10 text-[#059669]" : "text-muted-foreground",
                            )}
                            aria-current={isActive(item.href) ? "page" : undefined}
                        >
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="hidden items-center gap-2 md:flex">
                    {showAuthLinks ? (
                        <Button asChild variant="ghost">
                            <Link href="/auth/login">Log In</Link>
                        </Button>
                    ) : null}
                    <Button asChild className="bg-[#10B981] text-white hover:bg-[#059669]">
                        <Link href={ctaHref}>{ctaLabel}</Link>
                    </Button>
                </div>

                <Button 
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
                    aria-expanded={isMenuOpen}
                    aria-controls="mobile-navigation"
                    onClick={() => setIsMenuOpen((open) => !open)}
                >
                    {isMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
                </Button>
            </div>

            <div 
                id="mobile-navigation"
                className={cn(
                    "border-t border-border bg-card px-4 py-4 shadow-lg md:hidden",
                    isMenuOpen ? "block" : "hidden",
                )}
            >
                <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={closeMenu}
                            className={cn(
                                "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                isActive(item.href) ? "bg-[#10B981]/10 text-[#059669]" : "text-muted-foreground"
                            )}
                            aria-current={isActive(item.href) ? "page" : undefined}
                        >
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="mt-4 grid gap-2 border-t border-border pt-4">
                    {showAuthLinks ? (
                        <Button asChild variant="outline" className="w-full">
                            <Link href="/auth/login" onClick={closeMenu}>Log In</Link>
                        </Button>
                    ) : null}
                    <Button asChild className="w-full bg-[#10B981] text-white hover:bg-[#059669]">
                        <Link href={ctaHref} onClick={closeMenu}>{ctaLabel}</Link>
                    </Button>
                </div>
            </div>
        </header>
    );
}