// QQ 群机器人的 AI 聊天：手机上的模了个块脚本在群友 @机器人、又没命中问答时调用本函数，本函数调用 Claude 生成一句回复。
// 部署时 verify_jwt=false（脚本不登录）。凭据是后台生成的连接码：由数据库函数 qqbot_ai_claim 校验连接码、开关、群号和每日上限，
//   通过才调用 Claude（并先记一次）；用量（只有次数和 token 数）由 qqbot_ai_usage_add 记录。不保存群聊内容。
// Claude API 密钥只放在 Edge Function Secrets：ANTHROPIC_API_KEY（必填）；QQBOT_MODEL（选填，默认 claude-opus-5-5）。
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { cleanReply, parseInput, systemPrompt, userContent, type Persona } from "./lib.ts";

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

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  const secret = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !secret) return json(503, { ok: false, code: "ai_not_configured" });
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const c = await svc.rpc("qqbot_ai_claim", { p_token: p.v.token, p_group: p.v.group });
  if (c.error) { console.error("qqbot-chat: claim", c.error.message); return json(500, { ok: false, code: "db" }); }
  if (!c.data?.ok) return json(200, { ok: false, code: c.data?.code || "off" });
  const persona: Persona = { name: String(c.data.name || "小雷"), style: String(c.data.style || ""), faqs: Array.isArray(c.data.faqs) ? c.data.faqs : [] };

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
  let res;
  try {
    res = await client.beta.messages.create({
      model: Deno.env.get("QQBOT_MODEL") || "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low" }, // 群聊闲聊用 low 就够了，省 token
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // 被安全分类器拒绝时由服务端换模型重试
      system: systemPrompt(persona),
      messages: [{ role: "user", content: userContent(p.v) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) { console.error("qqbot-chat: bad ANTHROPIC_API_KEY"); return json(503, { ok: false, code: "ai_not_configured" }); }
    if (e instanceof Anthropic.RateLimitError) { console.error("qqbot-chat: rate limited"); return json(503, { ok: false, code: "ai_busy" }); }
    if (e instanceof Anthropic.APIError) { console.error("qqbot-chat: api error", e.status, e.message); return json(502, { ok: false, code: "ai_error" }); }
    console.error("qqbot-chat: network", (e as Error).message);
    return json(502, { ok: false, code: "ai_error" });
  }

  const used = await svc.rpc("qqbot_ai_usage_add", { p_group: p.v.group, p_in: res.usage?.input_tokens ?? 0, p_out: res.usage?.output_tokens ?? 0 });
  if (used.error) console.error("qqbot-chat: usage", used.error.message);
  if (res.stop_reason === "refusal") return json(200, { ok: false, code: "refused" });
  const text = res.content.map((b: { type: string; text?: string }) => (b.type === "text" ? b.text || "" : "")).join("");
  const reply = cleanReply(text, persona.name);
  if (!reply) return json(200, { ok: false, code: "empty" });
  return json(200, { ok: true, reply });
});
