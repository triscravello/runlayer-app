// Child-process fixture (not a test). The STATIC import below makes the real lib/prisma.ts build a real PrismaClient while this
// module is being loaded, which is the incident this guard exists for. It then probes what the isolation allows. Output is one
// JSON line of booleans, names and categories: never a URL, hostname or credential value.
import { readFileSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../../../lib/prisma.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const marker = (globalThis as { __RUNLAYER_TEST_ISOLATION__?: { active: boolean; profile: string } }).__RUNLAYER_TEST_ISOLATION__;
const hostOf = (value: string | undefined) => { try { return new URL(value ?? "").hostname; } catch { return "unparsable"; } };
const isolationError = (error: unknown) => (error as { name?: string } | null)?.name === "TestIsolationError";

const envKeyNames = ["", "prisma/"].flatMap((dir) => {
    try { return [...readFileSync(`${root}${dir}.env`, "utf8").matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((match) => match[1]); } catch { return []; }
});
const protectedNames = ["DIRECT_URL", "SHADOW_DATABASE_URL", "REDIS_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SUPABASE_URL", "SUPABASE_ANON_KEY", "WEATHER_API_KEY", "PGHOST", "CUSTOM_HOSTED_SERVICE_URL"];

const report: Record<string, unknown> = {
    guardActive: marker?.active === true,
    profile: marker?.profile,
    realClientBuiltDuringImport: typeof (prisma as { $connect?: unknown }).$connect === "function",
    databaseHost: hostOf(process.env.DATABASE_URL),
    protectedLeft: protectedNames.filter((name) => !!process.env[name]),
    envFileKeys: envKeyNames.length,
    envFileKeysNotBlank: envKeyNames.filter((name) => name !== "DATABASE_URL" && !!process.env[name]),
};

try { net.connect({ host: "db.example.invalid", port: 5432 }); report.socketBlocked = false; } catch (error) { report.socketBlocked = isolationError(error); }
try { await fetch("https://api.example.invalid/x"); report.fetchBlocked = false; } catch (error) { report.fetchBlocked = isolationError(error); }

process.env.DATABASE_URL = "postgresql://attacker:x@db.example.invalid:5432/prod"; // assigned AFTER startup
try { new PrismaClient(); report.lateHostedUrlBlocked = false; } catch (error) { report.lateHostedUrlBlocked = isolationError(error); }
try { new PrismaClient({ datasourceUrl: "postgresql://attacker:x@db.example.invalid:5432/prod" }); report.explicitHostedUrlBlocked = false; } catch (error) { report.explicitHostedUrlBlocked = isolationError(error); }

console.log(`REPORT ${JSON.stringify(report)}`);
