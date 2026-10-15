import type { ZodType } from "zod";
import { ApiError } from "@/lib/errors";

export type AIResult<T> = { data: T; inputTokens: number; outputTokens: number; cachedTokens: number; usageKnown?: boolean; rawResponse?: string };
export class AIResponseError extends ApiError {
  constructor(code: string, message: string, public readonly rawResponse: string, status = 502) { super(code, message, status); }
}

export interface AIProvider {
  readonly name: string;
  generate<T>(options: { model: string; systemPrompt: string; input: unknown; schema: ZodType<T> }): Promise<AIResult<T>>;
}
