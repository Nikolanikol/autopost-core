// Операции над брендами, которые затрагивают сразу несколько таблиц.
import { tx } from "./db";

export class MoveError extends Error {}

export interface MoveResult {
  posts: number;
  media_moved: number;
  media_copied: number;
  library_files: number;
  keys: number;
}

/**
 * Переносит аккаунт в другой бренд вместе с историей: его посты и использованные в них файлы.
 * Файл, который нужен ещё и оставшимся в старом бренде постам, копируется (в старом бренде остаётся оригинал).
 * Посты, опубликованные сразу в несколько аккаунтов, разделить нельзя — в таком случае перенос отклоняется.
 * withLibrary — перенести заодно всю медиатеку и API-ключи старого бренда (имеет смысл, когда он остаётся пустым).
 */
export function moveAccountToBrand(accountId: string, toBrandId: string, withLibrary = false): Promise<MoveResult> {
  return tx(async (c) => {
    const acc = (await c.query("select id, workspace_id, platform, external_id, username from social_accounts where id=$1 for update", [accountId])).rows[0];
    if (!acc) throw new MoveError("Аккаунт не найден");
    if (acc.workspace_id === toBrandId) throw new MoveError("Аккаунт уже в этом бренде");
    if (!(await c.query("select 1 from workspaces where id=$1", [toBrandId])).rows[0]) throw new MoveError("Бренд назначения не найден");
    if ((await c.query("select 1 from social_accounts where workspace_id=$1 and platform=$2 and external_id=$3", [toBrandId, acc.platform, acc.external_id])).rows[0])
      throw new MoveError("В бренде назначения уже есть этот аккаунт");
    const from = acc.workspace_id as string;

    const posts: string[] = (await c.query("select distinct post_id from post_targets where account_id=$1", [accountId])).rows.map((r) => r.post_id);

    if (posts.length) {
      const cross = (await c.query("select count(distinct post_id)::int as n from post_targets where post_id = any($1) and account_id <> $2", [posts, accountId])).rows[0].n;
      if (cross > 0)
        throw new MoveError(`${cross} пост(ов) опубликованы сразу в несколько аккаунтов — их нельзя разделить между брендами. Отмените эти посты или сначала перенесите все связанные аккаунты вместе.`);
      await c.query(
        `update posts set workspace_id=$2,
                idempotency_key = case when idempotency_key is not null and exists
                  (select 1 from posts x where x.workspace_id=$2 and x.idempotency_key = posts.idempotency_key) then null else idempotency_key end,
                updated_at=now()
          where id = any($1)`,
        [posts, toBrandId]
      );
    }

    // Файлы, использованные в переносимых постах.
    let moved = 0, copied = 0;
    if (posts.length) {
      const mids: string[] = (await c.query("select distinct unnest(media_ids) as id from post_targets where post_id = any($1)", [posts])).rows.map((r) => r.id);
      for (const mid of mids) {
        const shared = (await c.query("select 1 from post_targets where post_id <> all($1) and $2 = any(media_ids) limit 1", [posts, mid])).rows[0];
        if (!shared) {
          const r = await c.query("update media set workspace_id=$2 where id=$1 and workspace_id=$3", [mid, toBrandId, from]);
          moved += r.rowCount ?? 0;
        } else {
          const copy = (
            await c.query(
              `insert into media (workspace_id, kind, public_url, storage_key, mime, size_bytes, width, height, duration_sec, validation, source, filename)
               select $2, kind, public_url, storage_key, mime, size_bytes, width, height, duration_sec, validation, source, filename from media where id=$1
               returning id`,
              [mid, toBrandId]
            )
          ).rows[0];
          if (copy) {
            await c.query("update post_targets set media_ids = array_replace(media_ids, $1::uuid, $2::uuid) where post_id = any($3)", [mid, copy.id, posts]);
            copied++;
          }
        }
      }
    }

    let library = 0, keys = 0;
    if (withLibrary) {
      library = (await c.query("update media set workspace_id=$2 where workspace_id=$1", [from, toBrandId])).rowCount ?? 0;
      keys = (await c.query("update api_keys set workspace_id=$2 where workspace_id=$1 and scope='brand'", [from, toBrandId])).rowCount ?? 0;
    }

    await c.query("update social_accounts set workspace_id=$2, updated_at=now() where id=$1", [accountId, toBrandId]);
    await c.query("update comment_rules set workspace_id=$2 where account_id=$1", [accountId, toBrandId]);
    return { posts: posts.length, media_moved: moved, media_copied: copied, library_files: library, keys };
  });
}
