// Импортирует IG-аккаунт из .env (IG_ACCESS_TOKEN, IG_USER_ID) в базу — токен шифруется.
import { upsertAccount } from "@/lib/accounts";
import { defaultWorkspaceId, pool } from "@/lib/db";

const token = process.env.IG_ACCESS_TOKEN;
const id = process.env.IG_USER_ID;
if (!token || !id) throw new Error("Нужны IG_ACCESS_TOKEN и IG_USER_ID в .env");
const acc = await upsertAccount(await defaultWorkspaceId(), "instagram", id, token);
console.log(`Аккаунт сохранён: @${acc.username} (${acc.id})`);
await pool.end();
