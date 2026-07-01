import { BadRequestError } from "../http/apiErrors";

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new BadRequestError("CSV import must include a header row and at least one data row");

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  if (headers.some((header) => !header)) throw new BadRequestError("CSV headers cannot be blank");

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export async function parseAdminGearImportFile(file: File): Promise<unknown[]> {
    const text = await file.text();
    const filename = file.name.toLowerCase();
    const type = file.type.toLowerCase();

    if (filename.endsWith(".csv") || type.includes("csv")) {
        return parseCsv(text);
    }

    if (filename.endsWith(".json") || type.includes("json")) {
        try {
            const parsed: unknown = JSON.parse(text);
            if (!Array.isArray(parsed)) throw new BadRequestError("JSON import must be an array of gear item objects");
            return parsed;
        } catch (error) {
            if (error instanceof BadRequestError) throw error;
            throw new BadRequestError("Upload JSON could not be parsed.");
        }
    }

    throw new BadRequestError("Upload must be a .csv or .json file");
}