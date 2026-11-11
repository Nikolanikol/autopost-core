import Link from "next/link";
import { defaultWorkspaceId } from "@/lib/db";
import { listPostsBetween } from "@/lib/posts";
import { workspaceTz } from "@/lib/slots";
import { dayKey, wallTime, zonedToUtc } from "@/lib/tz";
import { AutoRefresh } from "../AutoRefresh";
import { Calendar, type CalDay, type CalPost } from "./Calendar";

export const dynamic = "force-dynamic";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ws = await defaultWorkspaceId();
  const tz = await workspaceTz(ws);
  const now = wallTime(new Date(), tz);
  const m = (await searchParams).m?.match(/^(\d{4})-(\d{2})$/);
  const year = m ? +m[1] : now.year;
  const month = m ? +m[2] : now.month;

  // Сетка: 6 недель, начиная с понедельника недели, где 1-е число.
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (first.getUTCDay() + 6) % 7;
  const days: CalDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 - shift + i));
    const key = d.toISOString().slice(0, 10);
    days.push({
      key,
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1,
      isToday: key === dayKey(new Date(), tz),
    });
  }
  const [fy, fm, fd] = days[0].key.split("-").map(Number);
  const [ly, lm, ld] = days[41].key.split("-").map(Number);
  const rows = await listPostsBetween(ws, zonedToUtc(fy, fm, fd, 0, 0, tz), zonedToUtc(ly, lm, ld + 1, 0, 0, tz));

  const posts: CalPost[] = rows.map((p: any) => {
    const w = wallTime(p.scheduled_at, tz);
    return {
      id: p.id,
      status: p.status,
      at: p.scheduled_at.toISOString(),
      day: dayKey(p.scheduled_at, tz),
      time: `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`,
      caption: p.base_caption?.slice(0, 80) ?? "",
      accounts: p.targets.map((t: any) => `@${t.username}`).join(", "),
    };
  });

  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;

  return (
    <>
      <AutoRefresh active={posts.some((p) => p.status === "publishing")} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>
          {MONTHS[month - 1]} {year}
        </h1>
        <div className="row" style={{ gap: 8 }}>
          <Link href={`/calendar?m=${prev}`}><button className="ghost">←</button></Link>
          <Link href="/calendar"><button className="ghost">Сегодня</button></Link>
          <Link href={`/calendar?m=${next}`}><button className="ghost">→</button></Link>
          <Link href="/posts/new"><button>+ Пост</button></Link>
        </div>
      </div>
      <p className="muted small">
        Часовой пояс: {tz}. Запланированные посты можно перетаскивать на другой день — время сохранится.
      </p>
      <Calendar days={days} posts={posts} tz={tz} />
    </>
  );
}
