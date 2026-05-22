import { getGear } from "@/services/gearService";
import { GearTable } from "@/components/admin/gear/GearTable";
import { GearImportForm } from "@/components/admin/gear/GearImportForm";
import { GearEditor } from "@/components/admin/gear/GearEditor";
import { GearFilters } from "@/components/admin/gear/GearFilters";

export default async function AdminGearPage() {
    const items = await getGear();
    return <main><h1>Admin Gear</h1><GearFilters /><GearImportForm /><GearEditor /><GearTable items={items} /></main>;
}