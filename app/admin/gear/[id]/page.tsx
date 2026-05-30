import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

export default async function AdminGearItemPage() {
    await requireAdmin();
    redirect("/admin/gear");
}