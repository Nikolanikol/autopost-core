import { NextResponse } from "next/server";
import { handler, requireApiKey } from "@/lib/apiAuth";
import { listAccounts } from "@/lib/accounts";

export const runtime = "nodejs";

/** Список подключённых аккаунтов — генераторам нужны их id для targets. */
export const GET = handler(async (req: Request) => {
  const ws = await requireApiKey(req);
  return NextResponse.json({ data: await listAccounts(ws) });
});
