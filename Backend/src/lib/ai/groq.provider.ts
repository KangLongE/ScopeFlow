import { z, type ZodType } from "zod";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import type { AIProvider, AIResult } from "./provider";

const groqResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().default(0), completion_tokens: z.number().int().default(0), cached_tokens: z.number().int().optional() }).optional(),
});

export class GroqProvider implements AIProvider {
  readonly name = "groq";

  async generate<T>({ model, systemPrompt, input, schema }: { model: string; systemPrompt: string; input: unknown; schema: ZodType<T> }): Promise<AIResult<T>> {
    const env = getEnv();
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_completion_tokens: env.AI_MAX_OUTPUT_TOKENS,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: JSON.stringify(input) }],
        response_format: { type: "json_schema", json_schema: { name: "scopeflow_response", strict: true, schema: z.toJSONSchema(schema) } },
      }),
    });
    if (!response.ok) throw new ApiError("AI_PROVIDER_ERROR", `AI 제공자 요청이 실패했습니다. (${response.status})`, 502);
    const payload = groqResponseSchema.parse(await response.json());
    let parsed: unknown;
    try { parsed = JSON.parse(payload.choices[0].message.content); } catch { throw new ApiError("AI_INVALID_RESPONSE", "AI가 올바른 JSON을 반환하지 않았습니다.", 502); }
    return { data: schema.parse(parsed), inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0, cachedTokens: payload.usage?.cached_tokens ?? 0 };
  }
}
