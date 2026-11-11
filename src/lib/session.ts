// Сессия интерфейса: cookie с HMAC от логина. Работает и в middleware (edge), и на сервере.
// Смена ADMIN_PASSWORD или APP_ENCRYPTION_KEY автоматически разлогинивает все сессии.

export const SESSION_COOKIE = "ap_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 дней

export async function sessionToken(): Promise<string> {
  const user = process.env.ADMIN_USER ?? "";
  const secret = `${process.env.ADMIN_PASSWORD ?? ""}:${process.env.APP_ENCRYPTION_KEY ?? ""}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`autopost-session:v1:${user}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Сравнение строк за постоянное время. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
