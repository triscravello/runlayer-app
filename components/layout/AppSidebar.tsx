"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bookmark, Gauge, History, LineChart, Shirt, Sparkles, User, Zap } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/layout/Sidebar";

const sections = [
  {
    label: "Main",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge, exact: true },
      { href: "/recommendation", label: "Recommendation", icon: Sparkles },
    ],
  },
  {
    label: "Personalization",
    items: [
      { href: "/dashboard/profile", label: "Profile", icon: User },
      { href: "/dashboard/saved-outfits", label: "Saved Outfits", icon: Bookmark },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/dashboard/history", label: "History", icon: History },
      { href: "/dashboard/insights", label: "Insights", icon: LineChart },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/compare", label: "Compare Gear", icon: Shirt },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin/gear", label: "Gear Catalog", icon: Shirt },
      { href: "/admin/analytics", label: "Admin Analytics", icon: BarChart3 },
    ],
  },
] as const;

function normalizePathname(pathname: string) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function isActivePath(pathname: string, href: string, exact?: boolean) {
  const current = normalizePathname(pathname);
  const target = normalizePathname(href);

  if (exact) {
    return current === target;
  }

  return current === target || current.startsWith(`${target}/`);
}

export default function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon" aria-label="RunLayer app navigation">
      <SidebarHeader className="border-b border-sidebar-border p-3">
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white">
            <Zap className="size-4" aria-hidden="true" />
          </span>
          <span className="truncate text-base font-semibold group-data-[collapsible=icon]:sr-only">RunLayer</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = isActivePath(pathname, item.href, "exact" in item ? item.exact : false);

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                        <Link
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => setOpenMobile(false)}
                        >
                          <Icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}