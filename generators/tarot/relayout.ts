// Раскладывает запланированные посты таро по порядку арканов в слоты (по умолчанию 10/15/20 по Сеулу).
// Посты, до публикации которых меньше часа, не трогает.
//
//   pnpm tsx --env-file=.env generators/tarot/relayout.ts [--dry]
//   SLOT_TZ_OFFSET=+09:00 SLOT_TIMES=10:00,15:00,20:00 — переопределить слоты
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const URL_ = process.env.AUTOPOST_URL!.replace(/\/$/, "");
const H = { authorization: `Bearer ${process.env.AUTOPOST_KEY}`, "content-type": "application/json" };
const OFFSET = process.env.SLOT_TZ_OFFSET ?? "+09:00";
const TIMES = (process.env.SLOT_TIMES ?? "10:00,15:00,20:00").split(",");
const DRY = process.argv.includes("--dry");
const TZ = process.env.DISPLAY_TZ || "Asia/Seoul";

const order: string[] = JSON.parse(await readFile(join(import.meta.dirname, "out/posts.json"), "utf8")).map(
  (p: { slug: string }) => `tarot-${p.slug}-v1`
);
const { data } = await (await fetch(`${URL_}/api/v1/posts?limit=200`, { headers: H })).json();
const horizon = Date.now() + 60 * 60e3;
const todo = data
  .filter((p: any) => p.status === "scheduled" && order.includes(p.idempotency_key) && new Date(p.scheduled_at).getTime() > horizon)
  .sort((a: any, b: any) => order.indexOf(a.idempotency_key) - order.indexOf(b.idempotency_key));

// Слоты: начиная с сегодняшнего дня в поясе слотов, только после horizon.
const offMin = (OFFSET.startsWith("-") ? -1 : 1) * (Number(OFFSET.slice(1, 3)) * 60 + Number(OFFSET.slice(4, 6)));
const localNow = new Date(Date.now() + offMin * 60e3);
const slots: string[] = [];
for (let day = 0; slots.length < todo.length && day < 60; day++) {
  const d = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + day));
  const ymd = d.toISOString().slice(0, 10);
  for (const t of TIMES) {
    const iso = `${ymd}T${t}:00${OFFSET}`;
    if (new Date(iso).getTime() > horizon && slots.length < todo.length) slots.push(iso);
  }
}

for (const [i, p] of todo.entries()) {
  const title = p.base_caption.split("\n")[0].split("—")[0].trim();
  const from = new Date(p.scheduled_at).toLocaleString("ru-RU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
  const to = new Date(slots[i]).toLocaleString("ru-RU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
  if (new Date(p.scheduled_at).getTime() === new Date(slots[i]).getTime()) {
    console.log(`= ${title.padEnd(32)} ${to}`);
    continue;
  }
  if (!DRY) {
    const r = await fetch(`${URL_}/api/v1/posts/${p.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ scheduled_at: slots[i] }) });
    if (!r.ok) throw new Error(`${title}: ${r.status} ${await r.text()}`);
  }
  console.log(`${DRY ? "~" : "→"} ${title.padEnd(32)} ${from} → ${to}`);
}
console.log(`${DRY ? "Проверка" : "Готово"}: ${todo.length} постов (${TZ})`);
