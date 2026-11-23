import pg from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: pg.Pool | undefined;
}

// Один пул на процесс (и на hot-reload в dev).
export const pool: pg.Pool =
  globalThis.__pgPool ?? (globalThis.__pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 }));

export async function q<T extends pg.QueryResultRow = any>(text: string, values: unknown[] = []) {
  return (await pool.query<T>(text, values)).rows;
}

export async function one<T extends pg.QueryResultRow = any>(text: string, values: unknown[] = []) {
  return (await pool.query<T>(text, values)).rows[0] as T | undefined;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export const BRAND_COOKIE = "ap_brand";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Текущий бренд (workspace): из cookie выбранного в шапке бренда; если cookie нет или бренд удалён — первый.
 * Вне веб-запроса (worker, скрипты) cookie недоступны — берётся первый workspace.
 * Имя функции оставлено прежним, чтобы не менять все страницы.
 */
export async function defaultWorkspaceId(): Promise<string> {
  try {
    const { cookies } = await import("next/headers");
    const id = (await cookies()).get(BRAND_COOKIE)?.value;
    if (id && UUID.test(id)) {
      const row = await one<{ id: string }>("select id from workspaces where id=$1", [id]);
      if (row) return row.id;
    }
  } catch {
    // нет контекста запроса — используем значение по умолчанию
  }
  const row = await one<{ id: string }>("select id from workspaces order by created_at limit 1");
  if (!row) throw new Error("Нет workspace — запустите миграции");
  return row.id;
}
