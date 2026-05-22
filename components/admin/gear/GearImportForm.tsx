"use client";
import { useState } from "react";

type ImportResult = Record<string, unknown> | null;

export function GearImportForm() {
    const [result, setResult] = useState<ImportResult>(null);
    async function onChange(e:React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        
        const fd = new FormData();
        fd.append('file', file);
        
        const res = await fetch('/api/admin/gear/import', {method: 'POST', body: fd});
        setResult(await res.json() as Record<string, unknown>);
    }

    return <div><input type="file" accept="application/json" onChange={onChange} /><pre>{result?JSON.stringify(result, null,2) : ""}</pre></div>;
}