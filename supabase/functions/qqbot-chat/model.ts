// 调用大模型：只用 Claude（Anthropic）。用户 2026-10-13 决定不接 GPT。
//   需要 Secrets ANTHROPIC_API_KEY；模型 QQBOT_MODEL，默认 claude-opus-5-5
// 返回统一的结果：文字、用量、是否被拒绝；出错时给一个 code（ai_not_configured / ai_busy / ai_error）。
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";

export type ModelResult = { ok: true; text: string; inTok: number; outTok: number; refused: boolean } | { ok: false; code: string; status: number };
export type Env = (name: string) => string | undefined;

export function modelKey(env: Env): string {
  return env("ANTHROPIC_API_KEY") || "";
}

export async function callModel(env: Env, system: string, user: string): Promise<ModelResult> {
  const apiKey = modelKey(env);
  if (!apiKey) return { ok: false, code: "ai_not_configured", status: 503 };
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
