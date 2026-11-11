import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, HttpError, requireApiKey } from "@/lib/apiAuth";
import { registerMediaUrl, registerUpload } from "@/lib/media";

export const runtime = "nodejs";

/**
 * Регистрирует медиа:
 *  - JSON `{ "url": "https://…" }` — файл уже лежит в публичном месте;
 *  - multipart/form-data с полем `file` — файл сохраняется в хранилище ядра.
 */
export const POST = handler(async (req: Request) => {
  const ws = await requireApiKey(req);
  try {
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) throw new Error("Нужно поле file");
      return NextResponse.json(await registerUpload(ws, file), { status: 201 });
    }
    const { url } = z.object({ url: z.string().url() }).parse(await req.json());
    return NextResponse.json(await registerMediaUrl(ws, url), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) throw e;
    throw new HttpError(422, (e as Error).message);
  }
});
