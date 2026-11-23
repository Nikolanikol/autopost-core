// Удалённый MCP-сервер (Streamable HTTP, без сессий): Claude на любом компьютере подключается по адресу
//   https://<домен>/api/mcp   с заголовком   Authorization: Bearer ak_…
// Ключ создаётся в «Настройках → API-ключи» с областью «Все бренды (для Claude)».
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { HttpError, requireApiKeyContext } from "@/lib/apiAuth";
import { buildServer } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  let ctx;
  try {
    ctx = await requireApiKeyContext(req);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: (e as Error).message }, id: null },
      { status, headers: status === 401 ? { "WWW-Authenticate": 'Bearer realm="autopost-core"' } : undefined }
    );
  }
  // Без сессий: на каждый запрос — свой экземпляр сервера (состояние хранится в БД, а не в памяти).
  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Ответ уже сформирован (JSON), закрываем экземпляр.
    transport.close?.().catch?.(() => {});
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
