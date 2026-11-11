import { encrypt } from "./crypto";
import { one, q } from "./db";
import { publisherFor } from "@/publishers";

/** Проверяет токен у платформы и сохраняет аккаунт (токен — зашифрованным). */
export async function upsertAccount(workspaceId: string, platform: string, externalId: string, token: string) {
  const { username } = await publisherFor(platform).verifyAccount(externalId.trim(), token.trim());
  return one(
    `insert into social_accounts (workspace_id, platform, external_id, username, token_enc, status)
     values ($1,$2,$3,$4,$5,'active')
     on conflict (workspace_id, platform, external_id)
     do update set username=excluded.username, token_enc=excluded.token_enc, status='active', updated_at=now()
     returning id, platform, external_id, username, status`,
    [workspaceId, platform, externalId.trim(), username, encrypt(token.trim())]
  );
}

export function listAccounts(workspaceId: string) {
  return q(
    `select id, platform, external_id, username, status, created_at, updated_at
       from social_accounts where workspace_id=$1 order by platform, username`,
    [workspaceId]
  );
}
