import PgBoss from "pg-boss";
import type pg from "pg";

export const PUBLISH_QUEUE = "publish-target";

export type PublishJob = { targetId: string; pollCount?: number };

declare global {
  // eslint-disable-next-line no-var
  var __boss: Promise<PgBoss> | undefined;
}

/** pg-boss живёт в том же Postgres (схема pgboss). supervise — только в worker. */
export function getBoss(opts: { supervise?: boolean } = {}): Promise<PgBoss> {
  if (!globalThis.__boss) {
    globalThis.__boss = (async () => {
      const boss = new PgBoss({
        connectionString: process.env.DATABASE_URL,
        supervise: opts.supervise ?? false,
        schedule: false,
      });
      boss.on("error", (e) => console.error("[pg-boss]", e));
      await boss.start();
      await boss.createQueue(PUBLISH_QUEUE, {
        name: PUBLISH_QUEUE,
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 15 * 60,
      });
      return boss;
    })().catch((e) => {
      globalThis.__boss = undefined;
      throw e;
    });
  }
  return globalThis.__boss;
}

/** Ставит публикацию цели в очередь. С client — в той же транзакции, что и запись поста. */
export async function enqueueTarget(
  job: PublishJob,
  startAfter?: Date | number,
  client?: pg.PoolClient
): Promise<void> {
  const boss = await getBoss();
  await boss.send(PUBLISH_QUEUE, job, {
    ...(startAfter !== undefined ? { startAfter } : {}),
    ...(client ? { db: { executeSql: (text: string, values: any[]) => client.query(text, values) } } : {}),
  });
}
