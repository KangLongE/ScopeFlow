import type { ZodType } from "zod";

export type AIResult<T> = { data: T; inputTokens: number; outputTokens: number; cachedTokens: number };

export interface AIProvider {
  readonly name: string;
  generate<T>(options: { model: string; systemPrompt: string; input: unknown; schema: ZodType<T> }): Promise<AIResult<T>>;
}

