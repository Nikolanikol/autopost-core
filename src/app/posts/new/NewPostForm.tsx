"use client";

import { RadioGroup } from "@radix-ui/themes";
import { useActionState, useEffect, useState } from "react";
import { createPostAction, previewNextSlotAction, type FormState } from "../../actions";
import { Area, Button, Check, Dropdown, Input } from "@/components/ui";

type Account = { id: string; platform: string; username: string };
type Media = { id: string; kind: "image" | "video"; url: string; width: number | null; height: number | null; warnings: string[] };
type Template = { id: string; kind: "caption" | "hashtags"; name: string; body: string };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function NewPostForm({ accounts, media, templates }: { accounts: Account[]; media: Media[]; templates: Template[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createPostAction, null);
  const [source, setSource] = useState<"library" | "url">(media.length ? "library" : "url");
  const [mediaId, setMediaId] = useState<string>("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState("auto");
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState<string[]>(accounts.length === 1 ? [accounts[0].id] : []);
  const [when, setWhen] = useState<"now" | "later" | "slot">("now");
  const [local, setLocal] = useState("");
  const [slot, setSlot] = useState<string | null | undefined>(undefined);
  const [showMore, setShowMore] = useState(false);

  // Ближайший свободный слот считается по первому выбранному аккаунту.
  useEffect(() => {
    if (when !== "slot" || !selected[0]) return;
    setSlot(undefined);
    previewNextSlotAction(selected[0]).then(setSlot);
  }, [when, selected]);

  const picked = source === "library" ? media.find((m) => m.id === mediaId) : null;
  const previewUrl = picked?.url ?? (source === "url" ? url : "");
  const previewKind = picked?.kind ?? (/\.(mp4|mov)(\?|$)/i.test(url) ? "video" : "image");
  const isReel = type === "reel" || (type === "auto" && previewKind === "video");
  const scheduleIso = when === "now" ? "now" : when === "slot" ? "next_slot" : local ? new Date(local).toISOString() : "";
  const insert = (body: string) => setCaption((c) => (c ? `${c.trimEnd()}\n\n${body}` : body));
  const me = accounts.find((a) => a.id === selected[0]);
  const capShort = caption.length > 125 && !showMore;

  return (
    <div className="two">
      <form action={action} className="card">
        <label>Медиа</label>
        <div className="tabs">
          <Button type="button" className={source === "library" ? "" : "ghost"} onClick={() => setSource("library")}>
            Из медиатеки
          </Button>
          <Button type="button" className={source === "url" ? "" : "ghost"} onClick={() => setSource("url")}>
            По ссылке
          </Button>
        </div>
        {source === "library" ? (
          media.length === 0 ? (
            <div className="muted small">Медиатека пуста — загрузите файлы в разделе «Медиатека».</div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
              {media.map((m) => (
                <label key={m.id} className="tile pick" style={{ margin: 0 }} title={m.warnings.join("\n")}>
                  <input type="radio" name="media_pick" checked={mediaId === m.id} onChange={() => setMediaId(m.id)} />
                  <div className="pic">
                    {m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt="" loading="lazy" />
                    ) : (
                      <video src={m.url} muted preload="metadata" />
                    )}
                  </div>
                  <div className="meta">
                    {m.kind === "video" ? "🎬" : "🖼"} {m.width && m.height ? `${m.width}×${m.height}` : ""}
                    {m.warnings.length ? <span className="err">⚠️ {m.warnings.length}</span> : null}
                  </div>
                </label>
              ))}
            </div>
          )
        ) : (
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/video.mp4 или фото .jpg" />
        )}
        <input type="hidden" name="media_id" value={source === "library" ? mediaId : ""} />
        <input type="hidden" name="media_url" value={source === "url" ? url : ""} />

        <label htmlFor="type">Формат</label>
        <Dropdown name="type" value={type} onValueChange={setType} ariaLabel="Формат" options={[
          { value: "auto", label: "Авто (фото → лента, видео → Reel)" },
          { value: "feed", label: "Пост в ленту (фото)" },
          { value: "reel", label: "Reel (видео)" },
          { value: "story", label: "История" },
        ]} />

        <label htmlFor="caption">Подпись</label>
        {templates.length > 0 && (
          <div className="tabs">
            {templates.map((t) => (
              <Button key={t.id} type="button" className="ghost small" onClick={() => insert(t.body)} title={t.body}>
                {t.kind === "hashtags" ? "#" : "+"} {t.name}
              </Button>
            ))}
          </div>
        )}
        <Area id="caption" name="caption" maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} />
        <div className="muted small">
          {caption.length} / 2200 · хэштегов: {(caption.match(/#[\p{L}\d_]+/gu) ?? []).length} / 30
        </div>

        <label>Аккаунты</label>
        {accounts.map((a) => (
          <Check
            key={a.id}
            name="account_id"
            value={a.id}
            checked={selected.includes(a.id)}
            onCheckedChange={(on) => setSelected((s) => (on ? [...s, a.id] : s.filter((x) => x !== a.id)))}
          >
            {a.platform === "instagram" ? "Instagram" : a.platform} · @{a.username}
          </Check>
        ))}

        <label>Когда</label>
        <RadioGroup.Root value={when} onValueChange={(v) => setWhen(v as "now" | "later" | "slot")}>
          <RadioGroup.Item value="now">Сейчас</RadioGroup.Item>
          <RadioGroup.Item value="slot">
            В ближайший свободный слот
            {when === "slot" && (
              <span className="muted small">
                {" "}
                {slot === undefined ? "…" : slot ? `→ ${fmt(slot)}` : "→ у аккаунта нет слотов (Аккаунты → Слоты)"}
              </span>
            )}
          </RadioGroup.Item>
          <RadioGroup.Item value="later">В указанное время</RadioGroup.Item>
        </RadioGroup.Root>
        {when === "later" && <Input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} required />}
        <input type="hidden" name="schedule_iso" value={scheduleIso} />

        {state?.error && (
          <div className="alert bad">
            {state.error}
            {state.issues?.length ? <ul>{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}
          </div>
        )}
        {state?.ok && (
          <div className="alert ok">
            {state.ok} — <a href="/">смотреть очередь</a>
            {state.issues?.length ? <ul>{state.issues.map((i) => <li key={i}>⚠️ {i}</li>)}</ul> : null}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <Button disabled={pending || (when === "slot" && !slot)}>
            {pending ? "Проверяю медиа…" : when === "now" ? "Опубликовать" : "Запланировать"}
          </Button>
        </div>
      </form>

      <aside>
        <div className="muted small" style={{ marginBottom: 6 }}>Превью Instagram</div>
        <div className="ig">
          <div className="ig-head">
            <div className="ig-ava" /> {me ? me.username : "аккаунт"}
          </div>
          <div className={`ig-media ${isReel ? "reel" : ""}`}>
            {!previewUrl ? (
              <div className="muted small" style={{ padding: 40 }}>Нет медиа</div>
            ) : previewKind === "video" ? (
              <video src={previewUrl} muted autoPlay loop playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" />
            )}
          </div>
          {type !== "story" && (
            <div className="ig-cap">
              {caption ? (
                <>
                  <b>{me?.username ?? "аккаунт"}</b> {capShort ? caption.slice(0, 125) + "… " : caption}
                  {capShort && (
                    <Button type="button" className="ghost small" style={{ padding: 0, border: 0 }} onClick={() => setShowMore(true)}>
                      ещё
                    </Button>
                  )}
                </>
              ) : (
                <span className="muted">Подпись появится здесь</span>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
