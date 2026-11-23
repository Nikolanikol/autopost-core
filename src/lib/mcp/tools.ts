// MCP-инструменты: через них Claude управляет сервисом (бренды, очередь, посты, аналитика, комментарии).
// Каждый инструмент — тонкая обёртка над функциями ядра, те же правила и проверки, что в интерфейсе.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, ZodError } from "zod";
import type { ApiKeyContext } from "@/lib/apiAuth";
import { listAccounts } from "@/lib/accounts";
import { syncAccountAnalytics } from "@/lib/analytics";
import { accountSummary, audience, dailySeries, onlineHours, topMedia } from "@/lib/analyticsQueries";
import { ignoreComment, perform, syncComments } from "@/lib/comments";
import { one, q } from "@/lib/db";
import { probeUrl, registerMediaUrl } from "@/lib/media";
import { cancelPost, createPost, getPost, reschedulePost, retryTarget, ValidationError } from "@/lib/posts";
import { listSlots, nextFreeSlot, WEEKDAYS } from "@/lib/slots";
import { fmtIn, tzLabel } from "@/lib/tz";
import { publisherFor, type MediaItem } from "@/publishers";

class ToolError extends Error {}

type Brand = { id: string; name: string; timezone: string };
type Acc = { id: string; username: string | null; platform: string; status: string; external_id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────── Разрешение бренда и аккаунта ───────── */

async function pickBrand(ctx: ApiKeyContext, arg?: string): Promise<Brand> {
  const brands = await q<Brand>("select id, name, timezone from workspaces order by created_at");
  const norm = (s: string) => s.trim().toLowerCase();
  if (ctx.scope === "brand") {
    const own = brands.find((b) => b.id === ctx.workspaceId);
    if (!own) throw new ToolError("Бренд ключа не найден");
    if (arg && norm(arg) !== norm(own.name) && arg !== own.id)
      throw new ToolError(`Этот ключ работает только с брендом «${own.name}». Для других брендов нужен ключ «все бренды».`);
    return own;
  }
  if (arg) {
    const hit =
      brands.find((b) => b.id === arg) ??
      brands.find((b) => norm(b.name) === norm(arg)) ??
      (brands.filter((b) => norm(b.name).includes(norm(arg))).length === 1 ? brands.find((b) => norm(b.name).includes(norm(arg))) : undefined);
    if (!hit) throw new ToolError(`Бренд «${arg}» не найден. Доступны: ${brands.map((b) => b.name).join(", ")}`);
    return hit;
  }
  if (brands.length === 1) return brands[0];
  throw new ToolError(`Укажите параметр brand. Доступные бренды: ${brands.map((b) => b.name).join(", ")}`);
}

async function pickAccount(brand: Brand, arg?: string): Promise<Acc> {
  const accs = await q<Acc>(
    "select id, username, platform, status, external_id from social_accounts where workspace_id=$1 order by username",
    [brand.id]
  );
  if (arg) {
    const a = arg.replace(/^@/, "").toLowerCase();
    const hit = accs.find((x) => x.id === arg || x.username?.toLowerCase() === a);
    if (!hit) throw new ToolError(`Аккаунт «${arg}» не найден в бренде «${brand.name}». Есть: ${accs.map((x) => "@" + x.username).join(", ") || "нет аккаунтов"}`);
    return hit;
  }
  if (accs.length === 1) return accs[0];
  throw new ToolError(`Укажите account (@username или id). В бренде «${brand.name}»: ${accs.map((x) => "@" + x.username).join(", ") || "нет аккаунтов"}`);
}

const when = (d: Date | string | null, tz: string) =>
  d ? { utc: new Date(d).toISOString(), local: fmtIn(new Date(d), tz) } : null;

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] });
const fail = (message: string, details?: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: details ? `${message}\n${JSON.stringify(details, null, 1)}` : message }],
});

/* ───────── Сервер ───────── */

const INSTRUCTIONS = `Сервис автопостинга и аналитики Instagram с несколькими брендами (у каждого свои аккаунты, очередь, комментарии).
Правила работы:
1. Начни с overview — он покажет бренды, аккаунты, очередь и новые комментарии. Параметр brand нужен почти везде; не угадывай бренд — если не уверен, спроси пользователя.
2. Публикации и ответы видны публично. Перед create_post и reply_comment покажи пользователю итоговый текст и время и дождись согласия, если он не сказал «публикуй сам». Для нового сценария сначала вызови create_post с dry_run=true.
3. Время: schedule принимает 'next_slot' (ближайший свободный слот аккаунта — предпочтительно), 'now' или ISO-время со смещением (например 2026-12-01T10:00:00+03:00). Часовой пояс бренда указан в ответах; показывай пользователю локальное время.
4. Перед планированием посмотри list_queue, чтобы не ставить два поста на одно время и видеть порядок публикаций.
5. Аналитика берётся из базы (обновляется раз в 3 часа); analytics_refresh запрашивай только если нужны свежие цифры.
6. Не делай выводов по нулям: у новых аккаунтов (<100 подписчиков) Instagram не отдаёт часть метрик.
7. Ошибки инструментов возвращаются текстом — прочти причину и исправь запрос, а не повторяй его вслепую.`;

export function buildServer(ctx: ApiKeyContext) {
  const server = new McpServer({ name: "autopost-core", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const brandArg = z.string().optional().describe("Название или id бренда. Обязателен, если брендов несколько.");
  const accountArg = z.string().optional().describe("@username или id аккаунта. Можно не указывать, если в бренде один аккаунт.");

  type Hints = { readOnly?: boolean; destructive?: boolean; idempotent?: boolean; external?: boolean };
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    hints: Hints,
    fn: (a: z.infer<z.ZodObject<S>>) => Promise<unknown>
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: shape,
        annotations: {
          readOnlyHint: Boolean(hints.readOnly),
          destructiveHint: hints.readOnly ? false : Boolean(hints.destructive),
          idempotentHint: Boolean(hints.idempotent ?? hints.readOnly),
          openWorldHint: Boolean(hints.external),
        },
      },
      (async (args: any) => {
        try {
          return ok(await fn(args));
        } catch (e) {
          if (e instanceof ToolError) return fail(e.message);
          if (e instanceof ValidationError) return fail("Пост не прошёл проверку", e.issues);
          if (e instanceof ZodError) return fail("Неверные параметры", e.issues);
          console.error(`[mcp] ${name}:`, e);
          return fail(`Ошибка: ${(e as Error).message}`);
        }
      }) as any
    );
  }

  /* ── Обзор и бренды ── */

  tool("list_brands", "Список брендов и число аккаунтов в каждом.", {}, { readOnly: true }, async () => {
    const rows = await q<any>(
      `select w.id, w.name, w.timezone, (select count(*) from social_accounts a where a.workspace_id=w.id)::int as accounts
         from workspaces w order by w.created_at`
    );
    return ctx.scope === "brand" ? rows.filter((r) => r.id === ctx.workspaceId) : rows;
  });

  tool(
    "overview",
    "Сводка по бренду: аккаунты и их лимиты, очередь на ближайшие дни, ошибки публикаций, новые комментарии. Начинай с этого инструмента.",
    { brand: brandArg },
    { readOnly: true },
    async ({ brand: b }) => {
      const brand = await pickBrand(ctx, b);
      const accounts = await q<any>(
        `select a.id, a.username, a.platform, a.status,
                (select count(*) from ig_comments c where c.account_id=a.id and c.status in ('new','failed') and c.parent_id is null)::int as new_comments
           from social_accounts a where a.workspace_id=$1 order by a.username`,
        [brand.id]
      );
      const counts = await q<any>(
        `select status, count(*)::int as n from posts where workspace_id=$1 and (scheduled_at >= now() - interval '1 day' or status in ('scheduled','publishing','failed','partial'))
          group by status`,
        [brand.id]
      );
      const upcoming = await q<any>(
        `select p.id, p.scheduled_at, p.status, left(p.base_caption, 80) as caption,
                (select string_agg('@' || a.username, ', ') from post_targets t join social_accounts a on a.id=t.account_id where t.post_id=p.id) as accounts
           from posts p where p.workspace_id=$1 and p.status in ('scheduled','publishing') order by p.scheduled_at limit 8`,
        [brand.id]
      );
      const failed = await q<any>(
        `select p.id, p.scheduled_at, t.last_error, a.username
           from posts p join post_targets t on t.post_id=p.id join social_accounts a on a.id=t.account_id
          where p.workspace_id=$1 and t.status='failed' and p.scheduled_at > now() - interval '7 days' order by p.scheduled_at desc limit 5`,
        [brand.id]
      );
      return {
        brand: { name: brand.name, id: brand.id, timezone: `${brand.timezone} (${tzLabel(brand.timezone)})` },
        now_local: fmtIn(new Date(), brand.timezone),
        accounts: accounts.map((a) => ({ ...a, username: "@" + a.username })),
        posts_by_status: Object.fromEntries(counts.map((c) => [c.status, c.n])),
        upcoming: upcoming.map((p) => ({ ...p, scheduled_at: when(p.scheduled_at, brand.timezone) })),
        failed_recent: failed.map((f) => ({ ...f, scheduled_at: when(f.scheduled_at, brand.timezone) })),
      };
    }
  );

  tool(
    "create_brand",
    "Создать новый бренд (пространство со своими аккаунтами и очередью). Только для ключа «все бренды».",
    { name: z.string().min(1).max(60) },
    {},
    async ({ name }) => {
      if (ctx.scope !== "all") throw new ToolError("Создавать бренды может только ключ «все бренды».");
      const cur = await one<{ timezone: string }>("select timezone from workspaces where id=$1", [ctx.workspaceId]);
      const row = await one<any>("insert into workspaces (name, timezone) values ($1,$2) returning id, name, timezone", [name.trim(), cur?.timezone ?? "Europe/Moscow"]);
      return { created: row, next: "Подключите аккаунт Instagram в интерфейсе: «Аккаунты» при выбранном бренде." };
    }
  );

  /* ── Аккаунты, слоты, медиа ── */

  tool("list_accounts", "Аккаунты бренда: id, ник, платформа, статус (active / needs_reauth / disabled).", { brand: brandArg }, { readOnly: true }, async ({ brand: b }) => {
    const brand = await pickBrand(ctx, b);
    return (await listAccounts(brand.id)).map((a: any) => ({ id: a.id, username: "@" + a.username, platform: a.platform, status: a.status }));
  });

  tool(
    "get_slots",
    "Слоты расписания аккаунта (день недели + время в поясе бренда) и ближайшие свободные слоты.",
    { brand: brandArg, account: accountArg, upcoming: z.number().int().min(1).max(14).default(5).describe("Сколько ближайших свободных слотов показать") },
    { readOnly: true },
    async ({ brand: b, account, upcoming }) => {
      const brand = await pickBrand(ctx, b);
      const acc = await pickAccount(brand, account);
      const slots = await listSlots(acc.id);
      const free: unknown[] = [];
      let after = new Date();
      for (let i = 0; i < upcoming; i++) {
        const s = await nextFreeSlot(brand.id, acc.id, after);
        if (!s) break;
        free.push(when(s, brand.timezone));
        after = new Date(s.getTime() + 60_000);
      }
      return {
        account: "@" + acc.username,
        timezone: brand.timezone,
        slots: slots.map((s) => `${WEEKDAYS[s.weekday]} ${s.at_time}`),
        next_free_slots: free,
        note: slots.length === 0 ? "Слотов нет — schedule='next_slot' не сработает. Добавьте через set_slots." : undefined,
      };
    }
  );

  tool(
    "set_slots",
    "Добавить слоты расписания аккаунта (по умолчанию дополняет существующие). replace=true удаляет все прежние слоты перед добавлением.",
    {
      brand: brandArg,
      account: accountArg,
      slots: z.array(z.object({
        weekdays: z.array(z.number().int().min(1).max(7)).min(1).describe("1=Пн … 7=Вс"),
        time: z.string().regex(/^\d{2}:\d{2}$/).describe("HH:MM в поясе бренда"),
      })).min(1),
      replace: z.boolean().default(false),
    },
    { destructive: true, idempotent: true },
    async ({ brand: b, account, slots, replace }) => {
      const brand = await pickBrand(ctx, b);
      const acc = await pickAccount(brand, account);
      if (replace) await q("delete from posting_slots where account_id=$1", [acc.id]);
      for (const s of slots)
        for (const wd of s.weekdays)
          await q("insert into posting_slots (account_id, weekday, at_time) values ($1,$2,$3) on conflict do nothing", [acc.id, wd, s.time]);
      return { account: "@" + acc.username, slots: (await listSlots(acc.id)).map((s) => `${WEEKDAYS[s.weekday]} ${s.at_time}`) };
    }
  );

  tool(
    "add_media",
    "Зарегистрировать медиа по публичному https-URL (проверка размеров, длительности, кодеков). Возвращает media_id для create_post. Для create_post можно передавать media_urls напрямую.",
    { brand: brandArg, url: z.string().url() },
    { external: true, idempotent: true },
    async ({ brand: b, url }) => {
      const brand = await pickBrand(ctx, b);
      try {
        const m: any = await registerMediaUrl(brand.id, url);
        return { media_id: m.id, kind: m.kind, width: m.width, height: m.height, duration_sec: m.duration_sec, warnings: m.validation?.warnings ?? [] };
      } catch (e) {
        throw new ToolError((e as Error).message);
      }
    }
  );

  /* ── Очередь и посты ── */

  tool(
    "list_queue",
    "Очередь публикаций бренда в порядке выхода. view=upcoming — запланированные (ближайшие первыми), history — уже вышедшие/ошибки/отменённые, all — всё.",
    {
      brand: brandArg,
      account: accountArg,
      view: z.enum(["upcoming", "history", "all"]).default("upcoming"),
      limit: z.number().int().min(1).max(100).default(30),
    },
    { readOnly: true },
    async ({ brand: b, account, view, limit }) => {
      const brand = await pickBrand(ctx, b);
      const acc = account ? await pickAccount(brand, account) : null;
      const st = view === "upcoming" ? "p.status in ('scheduled','publishing')" : view === "history" ? "p.status in ('published','partial','failed','canceled')" : "true";
      const order = view === "upcoming" ? "p.scheduled_at asc" : "p.scheduled_at desc nulls last";
      const rows = await q<any>(
        `select p.id, p.status, p.scheduled_at, left(p.base_caption, 120) as caption, p.source,
                (select json_agg(json_build_object('account', '@' || a.username, 'status', t.status, 'type', t.options->>'type',
                                                   'permalink', t.permalink, 'error', t.last_error) order by a.username)
                   from post_targets t join social_accounts a on a.id=t.account_id where t.post_id=p.id) as targets
           from posts p
          where p.workspace_id=$1 and ${st}
            and ($2::uuid is null or exists (select 1 from post_targets t where t.post_id=p.id and t.account_id=$2))
          order by ${order} limit $3`,
        [brand.id, acc?.id ?? null, limit]
      );
      return { brand: brand.name, timezone: brand.timezone, count: rows.length, posts: rows.map((r) => ({ ...r, scheduled_at: when(r.scheduled_at, brand.timezone) })) };
    }
  );

  tool("get_post", "Подробности поста: статус каждой цели, ссылки, ошибки.", { brand: brandArg, post_id: z.string().uuid() }, { readOnly: true }, async ({ brand: b, post_id }) => {
    const brand = await pickBrand(ctx, b);
    const p: any = await getPost(post_id);
    if (!p || p.workspace_id !== brand.id) throw new ToolError("Пост не найден в этом бренде");
    return { ...p, scheduled_at: when(p.scheduled_at, brand.timezone) };
  });

  tool(
    "create_post",
    "Создать пост (фото или Reels) в один или несколько аккаунтов бренда. ПУБЛИЧНОЕ действие: покажи пользователю текст и время до отправки. dry_run=true только проверяет медиа и показывает время выхода, ничего не создавая.",
    {
      brand: brandArg,
      caption: z.string().max(2200).default("").describe("Подпись"),
      media_urls: z.array(z.string().url()).default([]).describe("Публичные https-URL (jpeg / mp4)"),
      media_ids: z.array(z.string().uuid()).default([]).describe("id из add_media"),
      accounts: z.array(z.string()).min(1).describe("@username или id аккаунтов бренда"),
      type: z.enum(["reel", "feed", "story"]).optional().describe("По умолчанию: видео → reel, фото → feed"),
      share_to_feed: z.boolean().optional().describe("Reels: показывать ещё и в ленте (по умолчанию да)"),
      cover_url: z.string().url().optional().describe("Reels: обложка"),
      schedule: z.string().describe("'next_slot' (рекомендуется), 'now' или ISO-время со смещением, напр. 2026-12-01T10:00:00+03:00"),
      idempotency_key: z.string().max(200).optional().describe("Повтор с тем же ключом не создаст дубль"),
      dry_run: z.boolean().default(false),
    },
    { external: true },
    async (a) => {
      const brand = await pickBrand(ctx, a.brand);
      const accs: Acc[] = [];
      for (const x of a.accounts) accs.push(await pickAccount(brand, x));
      const options: Record<string, unknown> = {};
      if (a.type) options.type = a.type;
      if (a.share_to_feed === false) options.share_to_feed = false;
      if (a.cover_url) options.cover_url = a.cover_url;
      if (!/^(now|next_slot)$/.test(a.schedule) && Number.isNaN(Date.parse(a.schedule)))
        throw new ToolError("schedule: 'now', 'next_slot' или ISO-время со смещением, напр. 2026-12-01T10:00:00+03:00");

      if (a.dry_run) {
        const media: MediaItem[] = [];
        for (const url of a.media_urls) {
          try {
            const p = await probeUrl(url);
            media.push({ id: "-", kind: p.kind, public_url: url, width: p.width, height: p.height, duration_sec: p.duration ?? null });
          } catch (e) {
            throw new ToolError(`Медиа ${url}: ${(e as Error).message}`);
          }
        }
        if (a.media_ids.length) {
          const rows = await q<MediaItem>("select * from media where workspace_id=$1 and id = any($2)", [brand.id, a.media_ids]);
          if (rows.length !== a.media_ids.length) throw new ToolError("Часть media_ids не найдена в этом бренде");
          media.push(...rows);
        }
        if (media.length === 0) throw new ToolError("Нужно хотя бы одно медиа (media_urls или media_ids)");
        const issues = accs.flatMap((acc) =>
          [...(acc.status !== "active" ? [{ level: "error", message: "аккаунт требует переподключения" }] : []), ...publisherFor(acc.platform).validate(media, options)].map((i) => ({ ...i, account: "@" + acc.username }))
        );
        let at: Date | null = null;
        if (a.schedule === "now") at = new Date();
        else if (a.schedule === "next_slot") at = await nextFreeSlot(brand.id, accs[0].id);
        else at = new Date(a.schedule);
        if (a.schedule === "next_slot" && !at) issues.push({ level: "error", message: "нет слотов расписания", account: "@" + accs[0].username });
        return { dry_run: true, would_succeed: !issues.some((i) => i.level === "error"), publish_at: when(at, brand.timezone), accounts: accs.map((x) => "@" + x.username), issues };
      }

      const r = await createPost(
        brand.id,
        {
          caption: a.caption,
          media_urls: a.media_urls,
          media_ids: a.media_ids,
          targets: accs.map((acc) => ({ account_id: acc.id, options })),
          schedule: a.schedule as any,
          idempotency_key: a.idempotency_key,
        },
        "api"
      );
      const p: any = r.post;
      return {
        created: r.created,
        post_id: p.id,
        status: p.status,
        publish_at: when(p.scheduled_at, brand.timezone),
        targets: p.targets.map((t: any) => ({ account: "@" + t.username, status: t.status })),
        warnings: r.warnings ?? [],
      };
    }
  );

  tool(
    "reschedule_post",
    "Перенести запланированный пост на другое время (только статус scheduled, только в будущее).",
    { brand: brandArg, post_id: z.string().uuid(), scheduled_at: z.string().describe("ISO со смещением, напр. 2026-12-01T10:00:00+03:00") },
    { destructive: true, idempotent: true },
    async ({ brand: b, post_id, scheduled_at }) => {
      const brand = await pickBrand(ctx, b);
      const p: any = await getPost(post_id);
      if (!p || p.workspace_id !== brand.id) throw new ToolError("Пост не найден в этом бренде");
      const at = new Date(scheduled_at);
      if (Number.isNaN(at.getTime())) throw new ToolError("scheduled_at: нужен ISO-формат со смещением");
      if (at.getTime() < Date.now()) throw new ToolError("Нельзя перенести в прошлое");
      if (!(await reschedulePost(post_id, at))) throw new ToolError(`Переносить можно только запланированные посты (сейчас: ${p.status})`);
      return { post_id, publish_at: when(at, brand.timezone) };
    }
  );

  tool("cancel_post", "Отменить ещё не опубликованные цели поста. Уже вышедшее не удаляется.", { brand: brandArg, post_id: z.string().uuid() }, { destructive: true, idempotent: true }, async ({ brand: b, post_id }) => {
    const brand = await pickBrand(ctx, b);
    const p: any = await getPost(post_id);
    if (!p || p.workspace_id !== brand.id) throw new ToolError("Пост не найден в этом бренде");
    return { post_id, status: await cancelPost(post_id) };
  });

  tool("retry_post", "Повторить публикацию целей поста, которые завершились ошибкой.", { brand: brandArg, post_id: z.string().uuid() }, { external: true }, async ({ brand: b, post_id }) => {
    const brand = await pickBrand(ctx, b);
    const p: any = await getPost(post_id);
    if (!p || p.workspace_id !== brand.id) throw new ToolError("Пост не найден в этом бренде");
    const failed = p.targets.filter((t: any) => t.status === "failed");
    if (failed.length === 0) throw new ToolError("У поста нет целей с ошибкой");
    const res = [];
    for (const t of failed) res.push({ account: "@" + t.username, retried: await retryTarget(t.id) });
    return res;
  });

  /* ── Аналитика ── */

  const daysArg = z.number().int().min(1).max(30).default(7);
  tool(
    "analytics_summary",
    "Итоги аккаунта за период: подписчики, просмотры, охват, лайки, комментарии, репосты, сохранения, визиты в профиль, подписки/отписки, клики по кнопкам. series=true добавляет цифры по дням.",
    { brand: brandArg, account: accountArg, days: daysArg, series: z.boolean().default(false) },
    { readOnly: true },
    async ({ brand: b, account, days, series }) => {
      const brand = await pickBrand(ctx, b);
      const acc = await pickAccount(brand, account);
      return { account: "@" + acc.username, ...(await accountSummary(acc.id, days)), by_day: series ? await dailySeries(acc.id, days) : undefined };
    }
  );

  tool(
    "analytics_top_posts",
    "Публикации аккаунта с метриками (просмотры, охват, лайки, комментарии, репосты, сохранения, ER, среднее время просмотра Reels). Сортировка по любой метрике.",
    {
      brand: brandArg,
      account: accountArg,
      sort: z.enum(["date", "views", "reach", "likes", "comments", "shares", "saves", "er"]).default("views"),
      type: z.enum(["all", "reels", "feed"]).default("all"),
      since_days: z.number().int().min(1).max(365).optional().describe("Только публикации за последние N дней"),
      limit: z.number().int().min(1).max(50).default(10),
    },
    { readOnly: true },
    async ({ brand: b, account, sort, type, since_days, limit }) => {
      const brand = await pickBrand(ctx, b);
      const acc = await pickAccount(brand, account);
      return { account: "@" + acc.username, posts: await topMedia(acc.id, { sort, type, limit, since_days }) };
    }
  );

  tool("analytics_audience", "Аудитория аккаунта: страны, города, возраст, пол (доли в %).", { brand: brandArg, account: accountArg }, { readOnly: true }, async ({ brand: b, account }) => {
    const brand = await pickBrand(ctx, b);
    const acc = await pickAccount(brand, account);
    return { account: "@" + acc.username, ...(await audience(acc.id)) };
  });

  tool("analytics_online_hours", "Когда подписчики онлайн: лучшие часы для публикаций и среднее по каждому часу.", { brand: brandArg, account: accountArg }, { readOnly: true }, async ({ brand: b, account }) => {
    const brand = await pickBrand(ctx, b);
    const acc = await pickAccount(brand, account);
    return { account: "@" + acc.username, ...(await onlineHours(acc.id)) };
  });

  tool(
    "analytics_refresh",
    "Обновить статистику аккаунта из Instagram прямо сейчас (обычно она обновляется сама раз в 3 часа). Может занять до минуты.",
    { brand: brandArg, account: accountArg },
    { external: true, idempotent: true },
    async ({ brand: b, account }) => {
      const brand = await pickBrand(ctx, b);
      const acc = await pickAccount(brand, account);
      const r = await syncAccountAnalytics(acc.id);
      return { account: "@" + acc.username, refreshed: { media: r.media, post_insights: r.insights, days: r.days }, notes: r.notes.slice(0, 5) };
    }
  );

  /* ── Комментарии ── */

  async function ownComment(brand: Brand, id: string) {
    const c = await one<any>(
      "select c.*, a.username as account_username from ig_comments c join social_accounts a on a.id=c.account_id where c.id=$1 and a.workspace_id=$2",
      [id, brand.id]
    );
    if (!c) throw new ToolError("Комментарий не найден в этом бренде (нужен id из list_comments)");
    return c;
  }

  tool(
    "list_comments",
    "Комментарии под публикациями аккаунта. status: new — ждут ответа, done — обработанные, all. В ответе есть id (для ответа/скрытия), текст, автор, подобранное правило и заготовка ответа.",
    {
      brand: brandArg,
      account: accountArg,
      status: z.enum(["new", "done", "all"]).default("new"),
      limit: z.number().int().min(1).max(50).default(20),
    },
    { readOnly: true },
    async ({ brand: b, account, status, limit }) => {
      const brand = await pickBrand(ctx, b);
      const acc = await pickAccount(brand, account);
      const st = status === "new" ? "c.status in ('new','failed')" : status === "done" ? "c.status in ('replied','hidden')" : "c.status <> 'ignored'";
      const rows = await q<any>(
        `select c.id, c.username, c.text, c.commented_at, c.status, c.hidden, c.media_permalink, c.suggested_reply, c.suggested_dm,
                c.reply_text, c.last_error, r.name as rule
           from ig_comments c left join comment_rules r on r.id = c.matched_rule_id
          where c.account_id=$1 and c.parent_id is null and ${st} order by c.commented_at desc nulls last limit $2`,
        [acc.id, limit]
      );
      return { account: "@" + acc.username, count: rows.length, comments: rows.map((r) => ({ ...r, username: "@" + r.username, commented_at: when(r.commented_at, brand.timezone) })) };
    }
  );

  tool(
    "reply_comment",
    "Ответить на комментарий (ПУБЛИЧНО, необратимо) и/или отправить автору одно личное сообщение (до 7 дней после комментария). Отвечать можно только на комментарии верхнего уровня. Покажи пользователю текст до отправки.",
    {
      brand: brandArg,
      comment_id: z.string().uuid().describe("id из list_comments"),
      reply: z.string().max(2200).optional().describe("Публичный ответ в комментариях"),
      dm: z.string().max(1000).optional().describe("Личное сообщение автору"),
    },
    { external: true, destructive: true },
    async ({ brand: b, comment_id, reply, dm }) => {
      const brand = await pickBrand(ctx, b);
      const c = await ownComment(brand, comment_id);
      if (!reply?.trim() && !dm?.trim()) throw new ToolError("Нужен reply и/или dm");
      if (c.parent_id) throw new ToolError("Это ответ в ветке — Instagram позволяет отвечать только на комментарии верхнего уровня");
      if (c.status === "replied" && reply) throw new ToolError("На этот комментарий уже отвечено");
      const r = await perform(comment_id, { reply: reply?.trim() || undefined, dm: dm?.trim() || undefined });
      return { ok: r.ok, errors: r.errors, comment: `@${c.username}: ${String(c.text).slice(0, 80)}` };
    }
  );

  tool("hide_comment", "Скрыть комментарий (автор его не увидит) или вернуть (hide=false).", { brand: brandArg, comment_id: z.string().uuid(), hide: z.boolean().default(true) }, { external: true, idempotent: true }, async ({ brand: b, comment_id, hide }) => {
    const brand = await pickBrand(ctx, b);
    await ownComment(brand, comment_id);
    const r = await perform(comment_id, hide ? { hide: true } : { unhide: true });
    return { ok: r.ok, errors: r.errors };
  });

  tool("ignore_comment", "Пометить комментарий как не требующий ответа (в Instagram ничего не отправляется).", { brand: brandArg, comment_id: z.string().uuid() }, { idempotent: true }, async ({ brand: b, comment_id }) => {
    const brand = await pickBrand(ctx, b);
    await ownComment(brand, comment_id);
    await ignoreComment(comment_id);
    return { ok: true };
  });

  tool("sync_comments", "Подтянуть из Instagram комментарии, которые не дошли вебхуком (обычно не нужно: опрос идёт раз в 15 минут).", { brand: brandArg, account: accountArg }, { external: true, idempotent: true }, async ({ brand: b, account }) => {
    const brand = await pickBrand(ctx, b);
    const acc = await pickAccount(brand, account);
    return { account: "@" + acc.username, ...(await syncComments(acc.id)) };
  });

  tool("list_comment_rules", "Правила автоответа бренда: ключевые слова → ответ / личное сообщение / скрытие.", { brand: brandArg }, { readOnly: true }, async ({ brand: b }) => {
    const brand = await pickBrand(ctx, b);
    return q(
      `select r.id, r.name, r.keywords, r.action, r.reply_text, r.dm_text, r.auto, r.active, r.priority, coalesce('@' || a.username, 'все аккаунты') as scope
         from comment_rules r left join social_accounts a on a.id=r.account_id where r.workspace_id=$1 order by r.priority, r.created_at`,
      [brand.id]
    );
  });

  tool(
    "create_comment_rule",
    "Создать правило: если в комментарии есть любое из ключевых слов (регистр не важен, «*» — любой комментарий), ядро готовит ответ. auto=false (по умолчанию) — ответ только предлагается, отправляет человек; auto=true — отправляется сам (включай только по прямой просьбе пользователя). В тексте можно использовать {username}.",
    {
      brand: brandArg,
      name: z.string().min(1).max(80),
      keywords: z.array(z.string().min(1)).min(1),
      action: z.enum(["reply", "reply_dm", "dm", "hide"]),
      reply_text: z.string().max(2200).optional(),
      dm_text: z.string().max(1000).optional(),
      account: z.string().optional().describe("Только для этого аккаунта; без него — для всех аккаунтов бренда"),
      auto: z.boolean().default(false),
      priority: z.number().int().default(100),
    },
    {},
    async (a) => {
      const brand = await pickBrand(ctx, a.brand);
      const acc = a.account ? await pickAccount(brand, a.account) : null;
      if ((a.action === "reply" || a.action === "reply_dm") && !a.reply_text?.trim()) throw new ToolError("Для этого действия нужен reply_text");
      if ((a.action === "reply_dm" || a.action === "dm") && !a.dm_text?.trim()) throw new ToolError("Для этого действия нужен dm_text");
      const row = await one<any>(
        `insert into comment_rules (workspace_id, account_id, name, keywords, action, reply_text, dm_text, auto, priority)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, name, auto`,
        [brand.id, acc?.id ?? null, a.name.trim(), a.keywords.map((k) => k.trim()), a.action, a.reply_text?.trim() || null, a.dm_text?.trim() || null, a.auto, a.priority]
      );
      return { created: row };
    }
  );

  tool(
    "update_comment_rule",
    "Включить/выключить правило (active) или режим автоответа (auto).",
    { brand: brandArg, rule_id: z.string().uuid(), active: z.boolean().optional(), auto: z.boolean().optional() },
    { idempotent: true },
    async ({ brand: b, rule_id, active, auto }) => {
      const brand = await pickBrand(ctx, b);
      const row = await one<any>(
        "update comment_rules set active=coalesce($3, active), auto=coalesce($4, auto) where id=$1 and workspace_id=$2 returning id, name, active, auto",
        [rule_id, brand.id, active ?? null, auto ?? null]
      );
      if (!row) throw new ToolError("Правило не найдено в этом бренде");
      return row;
    }
  );

  tool("delete_comment_rule", "Удалить правило автоответа.", { brand: brandArg, rule_id: z.string().uuid() }, { destructive: true, idempotent: true }, async ({ brand: b, rule_id }) => {
    const brand = await pickBrand(ctx, b);
    const r = await q("delete from comment_rules where id=$1 and workspace_id=$2 returning id", [rule_id, brand.id]);
    if (r.length === 0) throw new ToolError("Правило не найдено в этом бренде");
    return { deleted: true };
  });

  return server;
}
