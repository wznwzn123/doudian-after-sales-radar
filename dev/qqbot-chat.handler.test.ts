// Tests (Deno, fake Supabase client + fake Anthropic SDK) for the 6.38 Edge Function qqbot-chat. No network, NOT a test against the real database or Claude.
// Run: deno test --no-lock --config dev/kuaidi100-fakes/deno.json -A dev/qqbot-chat.handler.test.ts
import { state } from "./kuaidi100-fakes/supabase.ts";
import { ai } from "./kuaidi100-fakes/anthropic.ts";
import Anthropic from "./kuaidi100-fakes/anthropic.ts";
import { cleanReply, parseInput, systemPrompt, userContent } from "../supabase/functions/qqbot-chat/lib.ts";

let handler: (r: Request) => Promise<Response> = async () => new Response();
(Deno as any).serve = (h: any) => { handler = h; return {} as any; };
const env = new Map<string, string>([["SUPABASE_URL", "https://x.supabase.co"], ["SUPABASE_SECRET_KEYS", '{"default":"sb_secret_test"}'], ["ANTHROPIC_API_KEY", "sk-ant-test"]]);
(Deno.env as any).get = (k: string) => env.get(k);
await import("../supabase/functions/qqbot-chat/index.ts");

const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const TOKEN = "ab".repeat(32);
const good = () => ({ token: TOKEN, group: "123456789", asker: "群友B", message: "@小雷 怎么注册啊", context: [{ who: "群友A", text: "有人用过售后雷达吗" }, { who: "你", text: "我在呢" }] });
const call = async (body: unknown, method = "POST") => {
  const r = await handler(new Request("https://x/functions/v1/qqbot-chat", { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined }));
  return { status: r.status, json: await r.json() };
};
function seed(claim: any = { ok: true, name: "小雷", style: "温柔一点", faqs: [{ keywords: ["注册"], answer: "点注册" }] }) {
  console.error = () => {};
  state.claims = []; state.usage = [];
  state.rpcs = {
    qqbot_ai_claim: (a: any) => { state.claims.push(a); return { data: claim, error: null }; },
    qqbot_ai_usage_add: (a: any) => { state.usage.push(a); return { data: null, error: null }; },
  };
  ai.calls = []; ai.reply = null; ai.error = null; ai.keys = [];
  env.set("ANTHROPIC_API_KEY", "sk-ant-test"); env.delete("QQBOT_MODEL");
}

Deno.test("lib: input checks", () => {
  ok(parseInput(good()).ok, "good input");
  eq((parseInput({ ...good(), token: "x" }) as any).code, "bad_token", "short token");
  eq((parseInput({ ...good(), group: "123 or 1" }) as any).code, "bad_group", "bad group");
  eq((parseInput({ ...good(), asker: "张三" }) as any).code, "bad_input", "asker must be anonymous");
  eq((parseInput({ ...good(), message: "字".repeat(301) }) as any).code, "bad_input", "message too long");
  eq((parseInput({ ...good(), context: [{ who: "张三", text: "x" }] }) as any).code, "bad_input", "context speaker must be anonymous");
  eq((parseInput({ ...good(), context: Array(9).fill({ who: "群友A", text: "x" }) }) as any).code, "bad_input", "context too long");
});

Deno.test("lib: system prompt keeps the AI honest and includes FAQs + style", () => {
  const s = systemPrompt({ name: "小雷", style: "温柔一点", faqs: [{ keywords: ["注册", "怎么注册"], answer: "点\n注册" }] });
  ok(s.includes("你是 AI") && s.includes("承认自己是 AI 助手") && s.includes("不要说自己是真人"), "AI disclosure rule");
  ok(s.includes("小雷") && s.includes("温柔一点") && s.includes("不能违背下面的规则"), "name + style under the rules");
  ok(s.includes("关键词：注册 / 怎么注册") && s.includes("回答：点 注册"), "faq");
  ok(!systemPrompt({ name: "小雷", style: "", faqs: [] }).includes("补充要求"), "no style line when empty");
});

Deno.test("lib: user content and reply cleanup", () => {
  const u = userContent(parseInput(good()).ok ? (parseInput(good()) as any).v : null);
  ok(u.includes("群友A：有人用过售后雷达吗") && u.includes("你：我在呢") && u.includes("群友B @了你：@小雷 怎么注册啊"), u);
  eq(cleanReply("小雷：「好的呀」", "小雷"), "好的呀", "prefix + quotes");
  eq(cleanReply("看这个[pic=/sdcard/a.png][atUin=1]", "小雷"), "看这个［pic=/sdcard/a.png]［atUin=1]", "send directives neutralised");
  eq(cleanReply("字".repeat(400), "小雷").length, 300, "capped");
  eq(cleanReply("  ", "小雷"), "", "empty");
});

Deno.test("handler: happy path -> claim, Claude call, usage, reply", async () => {
  seed();
  const r = await call(good());
  eq(r, { status: 200, json: { ok: true, reply: "哈哈对，点「注册」就行～" } }, "reply");
  eq(state.claims, [{ p_token: TOKEN, p_group: "123456789" }], "claim args");
  eq(state.usage, [{ p_group: "123456789", p_in: 900, p_out: 40 }], "usage recorded");
  const req = ai.calls[0];
  eq(ai.keys, ["sk-ant-test"], "api key from env");
  eq(req.model, "claude-opus-5-5", "default model");
  eq(req.output_config, { effort: "low" }, "low effort for chat");
  eq(req.betas, ["server-side-fallback-2026-07-01"], "fallback beta");
  eq(req.fallbacks, "default", "fallbacks");
  ok(!("thinking" in req) && !("temperature" in req), "no thinking/sampling params (400 on Opus 5.5)");
  ok(req.system.includes("温柔一点") && req.messages[0].content.includes("群友B @了你"), "prompt built");
  ok(!JSON.stringify(req).includes(TOKEN), "token never sent to Claude");
});

Deno.test("handler: QQBOT_MODEL overrides the model", async () => {
  seed(); env.set("QQBOT_MODEL", "claude-haiku-5-5");
  await call(good());
  eq(ai.calls[0].model, "claude-haiku-5-5", "model override");
});

Deno.test("handler: refused by the database -> no Claude call", async () => {
  for (const code of ["bad_token", "off", "group", "limit"]) {
    seed({ ok: false, code });
    eq(await call(good()), { status: 200, json: { ok: false, code } }, code);
    eq(ai.calls.length, 0, code + ": Claude not called");
  }
});

Deno.test("handler: bad input / wrong method / no key", async () => {
  seed();
  eq((await call({ ...good(), token: "x" })).json.code, "bad_token", "bad token");
  eq((await call({ ...good(), group: "abc" })).status, 400, "bad group");
  eq((await call(null, "GET")).status, 405, "GET");
  env.delete("ANTHROPIC_API_KEY");
  eq(await call(good()), { status: 503, json: { ok: false, code: "ai_not_configured" } }, "no key");
  eq(state.claims.length, 0, "nothing claimed without a key");
});

Deno.test("handler: Claude errors and refusals", async () => {
  seed(); ai.error = new (Anthropic as any).AuthenticationError(401, "invalid x-api-key");
  eq(await call(good()), { status: 503, json: { ok: false, code: "ai_not_configured" } }, "bad key");
  seed(); ai.error = new (Anthropic as any).RateLimitError(429, "slow down");
  eq((await call(good())).json.code, "ai_busy", "429");
  seed(); ai.error = new (Anthropic as any).APIError(500, "boom");
  eq((await call(good())).json.code, "ai_error", "500");
  seed(); ai.error = new Error("network down");
  eq((await call(good())).json.code, "ai_error", "network");
  seed(); ai.reply = { stop_reason: "refusal", content: [], usage: { input_tokens: 10, output_tokens: 0 } };
  eq((await call(good())).json, { ok: false, code: "refused" }, "refusal");
  eq(state.usage.length, 1, "refusal still records usage");
  seed(); ai.reply = { stop_reason: "end_turn", content: [{ type: "text", text: "  " }], usage: { input_tokens: 10, output_tokens: 1 } };
  eq((await call(good())).json, { ok: false, code: "empty" }, "empty reply");
});
