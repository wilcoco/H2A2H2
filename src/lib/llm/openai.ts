import OpenAI from "openai";
import type { ChatInput, ChatOutput, LlmAdapter, Provider } from "./types";

export function makeOpenAIAdapter(opts: { apiKey: string; model?: string; label?: string }): LlmAdapter {
  const model = opts.model || process.env.OPENAI_MODEL || "gpt-4o";
  const client = new OpenAI({ apiKey: opts.apiKey });
  return {
    name: opts.label || `openai:${model}`,
    provider: "openai" as Provider,
    async call(input: ChatInput): Promise<ChatOutput> {
      const body: Record<string, unknown> = {
        model,
        input: `${input.system}\n\n${input.user}`,
        temperature: input.temperature ?? 0.2,
        max_output_tokens: input.maxTokens ?? 1500,
      };
      if (input.previousResponseId) body.previous_response_id = input.previousResponseId;
      try {
        const r = await client.responses.create(body as unknown as Parameters<typeof client.responses.create>[0]);
        const text = (r as { output_text?: string }).output_text?.trim() ?? "";
        const responseId = (r as { id?: string }).id;
        const usage = (r as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        return {
          text,
          modelUsed: model,
          providerUsed: "openai",
          responseId,
          promptTokens: usage?.input_tokens,
          completionTokens: usage?.output_tokens,
        };
      } catch {
        if (model !== "gpt-4o") {
          const r2 = await client.responses.create({ ...(body as object), model: "gpt-4o" } as Parameters<typeof client.responses.create>[0]);
          const text = (r2 as { output_text?: string }).output_text?.trim() ?? "";
          return { text, modelUsed: "gpt-4o", providerUsed: "openai", responseId: (r2 as { id?: string }).id };
        }
        throw new Error("openai_call_failed");
      }
    },
  };
}
