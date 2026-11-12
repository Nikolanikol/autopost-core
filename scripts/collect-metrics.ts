// Разовый сбор статистики (то же самое worker делает по таймеру).
import { collectMetrics } from "@/lib/metrics";
import { pool } from "@/lib/db";

const r = await collectMetrics();
for (const n of r.notes) console.log("  •", n);
await pool.end();
