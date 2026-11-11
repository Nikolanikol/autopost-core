"use client";

import { useState, useTransition } from "react";
import { zonedToUtc } from "@/lib/tz";
import { reschedulePostAction } from "../actions";

export type CalDay = { key: string; day: number; inMonth: boolean; isToday: boolean };
export type CalPost = { id: string; status: string; at: string; day: string; time: string; caption: string; accounts: string };

const HEAD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function Calendar({ days, posts, tz }: { days: CalDay[]; posts: CalPost[]; tz: string }) {
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function drop(dayKey: string, postId: string) {
    setOver(null);
    const p = posts.find((x) => x.id === postId);
    if (!p || p.day === dayKey) return;
    const [y, m, d] = dayKey.split("-").map(Number);
    const [h, min] = p.time.split(":").map(Number);
    const at = zonedToUtc(y, m, d, h, min, tz);
    start(async () => {
      const r = await reschedulePostAction(postId, at.toISOString());
      setError(r.error ?? null);
    });
  }

  return (
    <>
      {error && <div className="alert bad">{error}</div>}
      <div className={`cal ${pending ? "busy" : ""}`}>
        {HEAD.map((h) => (
          <div key={h} className="cal-head">{h}</div>
        ))}
        {days.map((d) => (
          <div
            key={d.key}
            className={`cal-day ${d.inMonth ? "" : "out"} ${d.isToday ? "today" : ""} ${over === d.key ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(d.key);
            }}
            onDragLeave={() => setOver((o) => (o === d.key ? null : o))}
            onDrop={(e) => drop(d.key, e.dataTransfer.getData("text/post"))}
          >
            <div className="cal-num">{d.day}</div>
            {posts
              .filter((p) => p.day === d.key)
              .map((p) => (
                <div
                  key={p.id}
                  className={`cal-post s-${p.status}`}
                  draggable={p.status === "scheduled"}
                  onDragStart={(e) => e.dataTransfer.setData("text/post", p.id)}
                  title={`${p.accounts}\n${p.caption}`}
                >
                  <b>{p.time}</b> <span className="cal-acc">{p.accounts}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </>
  );
}
