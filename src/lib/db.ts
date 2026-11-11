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

/** MVP: один workspace. На этапе 3 сюда придёт выбор из сессии / API-ключа. */
export async function defaultWorkspaceId(): Promise<string> {
  const row = await one<{ id: string }>("select id from workspaces order by created_at limit 1");
  if (!row) throw new Error("Нет workspace — запустите миграции");
  return row.id;
}
