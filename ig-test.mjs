#!/usr/bin/env node
// Минимальный тест Instagram API: проверка токена и публикация.
// Запуск:  node --env-file=.env ig-test.mjs check
//          node --env-file=.env ig-test.mjs image <https-url-jpeg> [подпись]
//          node --env-file=.env ig-test.mjs reel  <https-url-mp4>  [подпись]
// Токен никогда не печатается.

const TOKEN = process.env.IG_ACCESS_TOKEN?.trim();
const IG_USER_ID = process.env.IG_USER_ID?.trim();
const VERSION = process.env.GRAPH_VERSION?.trim() || "v24.0";

if (!TOKEN || !IG_USER_ID) {
  console.error("Нет IG_ACCESS_TOKEN или IG_USER_ID в .env (см. .env.example)");
  process.exit(1);
}

// Токены входа через Instagram начинаются с "IG", токены Facebook/системного пользователя — с "EAA".
const HOST =
  process.env.GRAPH_HOST?.trim() ||
  (TOKEN.startsWith("IG") ? "graph.instagram.com" : "graph.facebook.com");
const BASE = `https://${HOST}/${VERSION}`;

async function api(method, path, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  let res;
  if (method === "GET") {
    url.search = body.toString();
    res = await fetch(url);
  } else {
    res = await fetch(url, { method, body });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    const err = new Error(
      `${method} /${path} → HTTP ${res.status}: ${e.message || "unknown error"}` +
        (e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : "") +
        (e.error_user_msg ? `\n  ${e.error_user_msg}` : "") +
        (e.fbtrace_id ? `\n  fbtrace_id: ${e.fbtrace_id}` : "")
    );
    err.data = data;
    throw err;
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check() {
  console.log(`Хост API: ${HOST}, версия ${VERSION}`);
  const me = await api("GET", IG_USER_ID, { fields: "id,username" });
  console.log(`Аккаунт: @${me.username} (id ${me.id})`);
  try {
    const lim = await api("GET", `${IG_USER_ID}/content_publishing_limit`, {
      fields: "quota_usage,config",
    });
    const d = lim.data?.[0];
    console.log(
      `Лимит публикаций: использовано ${d?.quota_usage ?? "?"} из ${d?.config?.quota_total ?? "?"} за 24ч`
    );
  } catch (e) {
    console.log(`Лимит публикаций не получен (не критично): ${e.message}`);
  }
  console.log("Токен рабочий ✅");
}

async function waitFinished(containerId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await api("GET", containerId, { fields: "status_code,status" });
    process.stdout.write(`  статус: ${s.status_code}\n`);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new Error(`Контейнер ${containerId}: ${s.status_code} ${s.status || ""}`);
    }
    await sleep(5000);
  }
  throw new Error("Не дождались обработки медиа (таймаут)");
}

async function publish(kind, mediaUrl, caption = "") {
  if (!mediaUrl?.startsWith("https://")) {
    throw new Error("Нужен публичный https-URL медиафайла");
  }
  const params =
    kind === "reel"
      ? { media_type: "REELS", video_url: mediaUrl, caption }
      : { image_url: mediaUrl, caption };

  console.log("1/3 создаю контейнер…");
  const { id: containerId } = await api("POST", `${IG_USER_ID}/media`, params);
  console.log(`  container id: ${containerId}`);

  console.log("2/3 жду обработки…");
  await waitFinished(containerId, kind === "reel" ? 10 * 60_000 : 2 * 60_000);

  console.log("3/3 публикую…");
  const { id: mediaId } = await api("POST", `${IG_USER_ID}/media_publish`, {
    creation_id: containerId,
  });
  const m = await api("GET", mediaId, { fields: "permalink" }).catch(() => ({}));
  console.log(`Опубликовано ✅ media id ${mediaId}${m.permalink ? `\n${m.permalink}` : ""}`);
}

const [cmd, url, ...rest] = process.argv.slice(2);
try {
  if (cmd === "check") await check();
  else if (cmd === "image" || cmd === "reel") await publish(cmd, url, rest.join(" "));
  else {
    console.log("Команды: check | image <url> [подпись] | reel <url> [подпись]");
    process.exit(1);
  }
} catch (e) {
  console.error(`Ошибка: ${e.message}`);
  process.exit(1);
}
