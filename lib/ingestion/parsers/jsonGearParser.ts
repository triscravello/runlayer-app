import { promises as fs } from "fs";
import path from "path";
import type { RawGearItemInput } from "../types";

type JsonGearFile = { items: RawGearItemInput[] };

export async function parseGearJsonFiles(contentDir = path.join(process.cwd(), "content", "gear")): Promise<RawGearItemInput[]> {
    const files = await fs.readdir(contentDir);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    const parsed = await Promise.all(
        jsonFiles.map(async (file) => {
            const filePath = path.join(contentDir, file);
            const data = await fs.readFile(filePath, "utf8");
            const json = JSON.parse(data) as JsonGearFile;
            return json.items ?? [];
        })
    );

    return parsed.flat();
}