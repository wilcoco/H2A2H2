import type { ChatInput, ChatOutput, LlmAdapter, Provider } from "./types";

export function makeAnthropicAdapter(opts: { apiKey: string; model?: string; label?: string }): LlmAdapter {
  const model = opts.model || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
  return {
    name: opts.label || `anthropic:${model}`,
    provider: "anthropic" as Provider,
    async call(input: ChatInput): Promise<ChatOutput> {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          system: input.system,
          max_tokens: input.maxTokens ?? 1500,
          temperature: input.temperature ?? 0.2,
          messages: [{ role: "user", content: [{ type: "text", text: input.user }] }],
        }),
      });
      if (!resp.ok) {
        throw new Error(`anthropic_call_failed_${resp.status}`);
      }
      const j = await resp.json().catch(() => ({})) as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
      const parts = Array.isArray(j.content) ? j.content : [];
      const text = parts.filter((p) => p?.type === "text").map((p) => String(p.text || "")).join("\n").trim();
      return {
        text,
        modelUsed: model,
        providerUsed: "anthropic",
        promptTokens: j.usage?.input_tokens,
        completionTokens: j.usage?.output_tokens,
      };
    },
  };
}
