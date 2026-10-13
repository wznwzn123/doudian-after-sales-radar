// QQ 群机器人的 AI 聊天：手机上的模了个块脚本在群友 @机器人、又没命中问答时（mention），或者开了「主动接话」时偶尔（chime）调用本函数，
// 本函数调用 Claude 生成一句文字回复（不发表情包；chime 时 AI 也可以选择不说话）。调用见 model.ts。
// 部署时 verify_jwt=false（脚本不登录）。凭据是后台生成的连接码：由数据库函数 qqbot_ai_claim 校验连接码、开关、群号和每日上限，
//   通过才调用模型（并先记一次）；用量（只有次数和 token 数）由 qqbot_ai_usage_add 记录。不保存群聊内容。
// 密钥只放在 Edge Function Secrets：ANTHROPIC_API_KEY，QQBOT_MODEL 选填。
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseInput, parseReply, systemPrompt, userContent, type Persona } from "./lib.ts";
import { callModel, modelKey } from "./model.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function envKey(jsonName: string, legacyName: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(jsonName) || "{}");
    if (keys.default) return keys.default;
  } catch { /* fall through */ }
  return Deno.env.get(legacyName) || "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false });
  let body: unknown = null;
  try { body = await req.json(); } catch { return json(400, { ok: false, code: "bad_input" }); }
  const p = parseInput(body);
  if (!p.ok) return json(400, { ok: false, code: p.code });

  const env = (n: string) => Deno.env.get(n);
  const secret = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!modelKey(env) || !secret) return json(503, { ok: false, code: "ai_not_configured" });
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const c = await svc.rpc("qqbot_ai_claim", { p_token: p.v.token, p_group: p.v.group });
  if (c.error) { console.error("qqbot-chat: claim", c.error.message); return json(500, { ok: false, code: "db" }); }
  if (!c.data?.ok) return json(200, { ok: false, code: c.data?.code || "off" });
  const persona: Persona = { name: String(c.data.name || "小雷"), style: String(c.data.style || ""), faqs: Array.isArray(c.data.faqs) ? c.data.faqs : [] };

  const res = await callModel(env, systemPrompt(persona), userContent(p.v));
  if (!res.ok) return json(res.status, { ok: false, code: res.code });

  const used = await svc.rpc("qqbot_ai_usage_add", { p_group: p.v.group, p_in: res.inTok, p_out: res.outTok });
  if (used.error) console.error("qqbot-chat: usage", used.error.message);
  if (res.refused) return json(200, { ok: false, code: "refused" });
  const out = parseReply(res.text, persona.name);
  if (out.skip) return json(200, { ok: false, code: "skip" });
  if (!out.reply) return json(200, { ok: false, code: "empty" });
  // sticker / sticker_url 一直是空的：旧版脚本（2.1～2.2.x）看到空网址就不发表情包
  return json(200, { ok: true, reply: out.reply, sticker: "", sticker_url: "" });
});
