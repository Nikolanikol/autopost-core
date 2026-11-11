// Отправляет сгенерированные посты таро в ядро через API (как это будет делать любой генератор).
//
//   AUTOPOST_URL=https://post.example.com AUTOPOST_KEY=ak_… AUTOPOST_ACCOUNT=<id> \
//     node generators/tarot/push.ts [next_slot | 2026-11-13T18:00:00+03:00 …]
//
// Без аргументов — каждый пост в ближайший свободный слот аккаунта.
// С датами — по порядку: первый пост на первую дату и т. д.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const URL_ = process.env.AUTOPOST_URL?.replace(/\/$/, "");
const KEY = process.env.AUTOPOST_KEY;
const ACCOUNT = process.env.AUTOPOST_ACCOUNT;
if (!URL_ || !KEY || !ACCOUNT) throw new Error("Нужны AUTOPOST_URL, AUTOPOST_KEY, AUTOPOST_ACCOUNT");

const dir = join(import.meta.dirname, "out");
const posts: { slug: string; image: string; caption: string }[] = JSON.parse(
  await readFile(join(dir, "posts.json"), "utf8")
);
const schedules = process.argv.slice(2);
const auth = { authorization: `Bearer ${KEY}` };

for (const [i, p] of posts.entries()) {
  const fd = new FormData();
  fd.append("file", new File([await readFile(join(import.meta.dirname, p.image))], `${p.slug}.jpg`, { type: "image/jpeg" }));
  const up = await fetch(`${URL_}/api/v1/media`, { method: "POST", headers: auth, body: fd });
  const media = await up.json();
  if (!up.ok) throw new Error(`${p.slug}: загрузка ${up.status} ${JSON.stringify(media)}`);

  const res = await fetch(`${URL_}/api/v1/posts`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", "x-source": "generator" },
    body: JSON.stringify({
      caption: p.caption,
      media_ids: [media.id],
      targets: [{ account_id: ACCOUNT, options: { type: "feed" } }],
      schedule: schedules[i] ?? schedules[0] ?? "next_slot",
      idempotency_key: `tarot-${p.slug}-v1`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${p.slug}: ${res.status} ${JSON.stringify(body)}`);
  console.log(
    `${res.status === 201 ? "✓ создан" : "= уже был"} ${p.slug} → ${new Date(body.post.scheduled_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК (${body.post.id})`
  );
}
