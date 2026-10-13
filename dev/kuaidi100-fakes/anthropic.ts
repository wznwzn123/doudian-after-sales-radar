// Fake @anthropic-ai/sdk for dev/qqbot-chat.handler.test.ts: records requests, returns canned responses. No network.
export const ai: any = { calls: [], reply: null, error: null, keys: [] };
class APIError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
class AuthenticationError extends APIError {}
class RateLimitError extends APIError {}
export default class Anthropic {
  static APIError = APIError;
  static AuthenticationError = AuthenticationError;
  static RateLimitError = RateLimitError;
  beta: any;
  constructor(opts: any) {
    ai.keys.push(opts?.apiKey);
    this.beta = { messages: { create: async (req: any) => {
      ai.calls.push(req);
      if (ai.error) throw ai.error;
      return ai.reply ?? { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "哈哈对，点「注册」就行～" }], usage: { input_tokens: 900, output_tokens: 40 } };
    } } };
  }
}
