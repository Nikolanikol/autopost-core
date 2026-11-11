import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { sha256 } from "./crypto";
import { one, q } from "./db";
import { ValidationError } from "./posts";

/** Авторизация API v1: заголовок `Authorization: Bearer ak_...`. Возвращает workspace_id. */
export async function requireApiKey(req: Request): Promise<string> {
  const h = req.headers.get("authorization") ?? "";
  const secret = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!secret) throw new HttpError(401, "Нужен заголовок Authorization: Bearer <api key>");
  const row = await one<{ id: string; workspace_id: string }>(
    "select id, workspace_id from api_keys where key_hash=$1 and revoked_at is null",
    [sha256(secret)]
  );
  if (!row) throw new HttpError(401, "Неверный или отозванный API-ключ");
  q("update api_keys set last_used_at=now() where id=$1", [row.id]).catch(() => {});
  return row.workspace_id;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Обёртка: единый формат ошибок { error, details }. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "Неверный запрос", details: e.issues }, { status: 400 });
      if (e instanceof ValidationError)
        return NextResponse.json({ error: "Медиа или опции не подходят", details: e.issues }, { status: 422 });
      console.error(e);
      return NextResponse.json({ error: (e as Error).message ?? "Внутренняя ошибка" }, { status: 500 });
    }
  };
}
