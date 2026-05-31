export type Tier = "free" | "point" | "byok";
export type Provider = "openai" | "anthropic";

export interface ChatInput {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  previousResponseId?: string;
}

export interface ChatOutput {
  text: string;
  modelUsed: string;
  providerUsed: Provider;
  responseId?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface LlmAdapter {
  name: string;
  provider: Provider;
  call(input: ChatInput): Promise<ChatOutput>;
}
