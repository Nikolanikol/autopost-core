// TikTok Login Kit (OAuth 2.0): подключение аккаунта и автообновление токена.
// Access-токен живёт 24 часа, refresh — 365 дней. В social_accounts.token_enc хранится зашифрованный JSON
// { access_token, refresh_token, access_expires_at, refresh_expires_at }.
import { decrypt, encrypt } from "./crypto";
import { one, q } from "./db";
import { publicBaseUrl } from "./storage";
import { TIKTOK_API, TikTokError, tiktok } from "@/publishers/tiktok";

export const TIKTOK_SCOPES = "user.info.basic,video.upload";

export interface TikTokTokens {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
}

export const tiktokConfigured = () => Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);

/** Этот адрес нужно добавить в кабинете TikTok: Login Kit → Redirect URI. Только https. */
export const tiktokRedirectUri = () => `${publicBaseUrl()}/api/oauth/tiktok/callback`;

export function tiktokAuthorizeUrl(state: string) {
  const p = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    scope: TIKTOK_SCOPES,
    response_type: "code",
    redirect_uri: tiktokRedirectUri(),
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${TIKTOK_API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      ...params,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => {
    throw new TikTokError(`network: ${(e as Error).message}`, 0, "network");
  });
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok || d.error || !d.access_token)
    throw new TikTokError(d.error_description || d.error || `HTTP ${res.status}`, res.status, d.error || "http_error");
  const now = Date.now();
  return {
    openId: d.open_id as string,
    tokens: {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      access_expires_at: new Date(now + Number(d.expires_in) * 1000).toISOString(),
      refresh_expires_at: new Date(now + Number(d.refresh_expires_in) * 1000).toISOString(),
    } satisfies TikTokTokens,
  };
}

/** Обмен кода авторизации на токены и сохранение аккаунта в бренде workspaceId. */
export async function connectTikTok(workspaceId: string, code: string) {
  const { openId, tokens } = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: tiktokRedirectUri(),
  });
  const { username } = await tiktok.verifyAccount(openId, tokens.access_token);
  return one<{ id: string; username: string }>(
    `insert into social_accounts (workspace_id, platform, external_id, username, token_enc, token_expires_at, status)
     values ($1,'tiktok',$2,$3,$4,$5,'active')
     on conflict (workspace_id, platform, external_id)
     do update set username=excluded.username, token_enc=excluded.token_enc,
                   token_expires_at=excluded.token_expires_at, status='active', updated_at=now()
     returning id, username`,
    [workspaceId, openId, username, encrypt(JSON.stringify(tokens)), tokens.refresh_expires_at]
  );
}

/** Действующий access-токен аккаунта; при необходимости обновляет и сохраняет новую пару. */
export async function tiktokAccessToken(accountId: string): Promise<string> {
  const row = await one<{ token_enc: string }>("select token_enc from social_accounts where id=$1", [accountId]);
  if (!row) throw new TikTokError("Аккаунт не найден", 404, "account_missing");
  let t: TikTokTokens;
  try {
    t = JSON.parse(decrypt(row.token_enc));
  } catch {
    throw new TikTokError("Токен TikTok повреждён — подключите аккаунт заново", 401, "invalid_grant");
  }
  if (new Date(t.access_expires_at).getTime() - Date.now() > 5 * 60_000) return t.access_token;
  if (new Date(t.refresh_expires_at).getTime() < Date.now())
    throw new TikTokError("Срок доступа TikTok истёк — подключите аккаунт заново", 401, "invalid_grant");

  const { tokens } = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  await q("update social_accounts set token_enc=$2, token_expires_at=$3, updated_at=now() where id=$1", [
    accountId,
    encrypt(JSON.stringify(tokens)),
    tokens.refresh_expires_at,
  ]);
  return tokens.access_token;
}
