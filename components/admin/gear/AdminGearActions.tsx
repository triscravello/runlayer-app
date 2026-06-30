"use client";

import { Download, PackagePlus, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const ADMIN_GEAR_ADD_EVENT = "runlayer:admin-gear:add";

export function AdminGearActions() {
    return (
        <div className="flex flex-wrap gap-2">
            <Button 
                type="button"
                variant="outline"
                onClick={() => window.dispatchEvent(new CustomEvent(ADMIN_GEAR_ADD_EVENT))}
                className="border-zinc-700 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800"
            >
                <PackagePlus className="size-4" /> Add Gear
            </Button>
            <Button disabled variant="outline" className="border-zinc-700 bg-zinc-900/80 text-zinc-500 opacity-70 hover:bg-zinc-900/80">
                <UploadCloud className="size-4" /> Import Catalog <span className="text-xs text-zinc-600">Coming Soon</span>
            </Button>
            <Button disabled className="bg-zinc-800 text-zinc-500 opacity-70 hover:bg-zinc-800">
                <Download className="size-4" /> Export JSON <span className="text-xs text-zinc-600">Coming Soon</span>
            </Button>
        </div>
    );
}