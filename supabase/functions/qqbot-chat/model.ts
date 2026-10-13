// 调用大模型：Claude（Anthropic）或 GPT（OpenAI）。用哪个由 Edge Function Secrets 决定：
//   QQBOT_PROVIDER = "openai" → GPT（需要 OPENAI_API_KEY；模型 OPENAI_MODEL，默认 gpt-5.4-mini）
//   其他 / 不填 → Claude（需要 ANTHROPIC_API_KEY；模型 QQBOT_MODEL，默认 claude-opus-5-5）
// 返回统一的结果：文字、用量、是否被拒绝；出错时给一个 code（ai_not_configured / ai_busy / ai_error）。
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";

export type ModelResult = { ok: true; text: string; inTok: number; outTok: number; refused: boolean } | { ok: false; code: string; status: number };
export type Env = (name: string) => string | undefined;

export function pickProvider(env: Env): { provider: "claude" | "openai"; key: string } {
  const p = (env("QQBOT_PROVIDER") || "").trim().toLowerCase();
  if (p === "openai" || p === "gpt") return { provider: "openai", key: env("OPENAI_API_KEY") || "" };
  return { provider: "claude", key: env("ANTHROPIC_API_KEY") || "" };
}

export async function callModel(env: Env, system: string, user: string, fetcher: typeof fetch = fetch): Promise<ModelResult> {
  const { provider, key } = pickProvider(env);
  if (!key) return { ok: false, code: "ai_not_configured", status: 503 };
  return provider === "openai" ? callOpenAI(env, key, system, user, fetcher) : callClaude(env, key, system, user);
}

async function callClaude(env: Env, apiKey: string, system: string, user: string): Promise<ModelResult> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
  try {
    const res = await client.beta.messages.create({
      model: env("QQBOT_MODEL") || "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low" }, // 群聊闲聊用 low 就够了，省 token
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // 被安全分类器拒绝时由服务端换模型重试
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content.map((b: { type: string; text?: string }) => (b.type === "text" ? b.text || "" : "")).join("");
    return { ok: true, text, inTok: res.usage?.input_tokens ?? 0, outTok: res.usage?.output_tokens ?? 0, refused: res.stop_reason === "refusal" };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) { console.error("qqbot-chat: bad ANTHROPIC_API_KEY"); return { ok: false, code: "ai_not_configured", status: 503 }; }
    if (e instanceof Anthropic.RateLimitError) { console.error("qqbot-chat: claude rate limited"); return { ok: false, code: "ai_busy", status: 503 }; }
    if (e instanceof Anthropic.APIError) { console.error("qqbot-chat: claude api error", e.status, e.message); return { ok: false, code: "ai_error", status: 502 }; }
    console.error("qqbot-chat: claude network", (e as Error).message);
    return { ok: false, code: "ai_error", status: 502 };
  }
}

// OpenAI Chat Completions。reasoning_effort 设 low 省 token；如果所选模型不支持这个参数（400 且提到它），去掉再试一次。
async function callOpenAI(env: Env, apiKey: string, system: string, user: string, fetcher: typeof fetch): Promise<ModelResult> {
  const model = env("OPENAI_MODEL") || "gpt-5.4-mini";
  const body: Record<string, unknown> = { model, max_completion_tokens: 2000, reasoning_effort: "low", messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Response;
    try {
      r = await fetcher("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    } catch (e) {
      console.error("qqbot-chat: openai network", (e as Error).message);
      return { ok: false, code: "ai_error", status: 502 };
    }
    let d: any = null;
    try { d = await r.json(); } catch { /* not JSON */ }
    if (r.ok && d) {
      const m = d.choices?.[0]?.message || {};
      return { ok: true, text: typeof m.content === "string" ? m.content : "", inTok: d.usage?.prompt_tokens ?? 0, outTok: d.usage?.completion_tokens ?? 0, refused: !!m.refusal };
    }
    const msg = String(d?.error?.message || "");
    if (r.status === 400 && attempt === 0 && /reasoning_effort/i.test(msg)) { delete body.reasoning_effort; continue; }
    console.error("qqbot-chat: openai error", r.status, msg.slice(0, 200));
    if (r.status === 401 || r.status === 403) return { ok: false, code: "ai_not_configured", status: 503 };
    if (r.status === 429) return { ok: false, code: "ai_busy", status: 503 };
    return { ok: false, code: "ai_error", status: 502 };
  }
  return { ok: false, code: "ai_error", status: 502 };
}
