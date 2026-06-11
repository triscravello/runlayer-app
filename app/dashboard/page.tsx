import { redirect } from "next/navigation";

import { DashboardClient, type DashboardUser } from "@/components/dashboard/DashboardClient";
import { getSessionUser } from "@/lib/auth";

export default async function DashboardPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  const dashboardUser: DashboardUser = {
    id: user.id,
    email: user.email,
    role: user.role,
  };

  return <DashboardClient user={dashboardUser} />;
}