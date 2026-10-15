import { z, type ZodType } from "zod";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import type { AIProvider, AIResult } from "./provider";
import { AIResponseError } from "./provider";

const groqResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().min(0).optional(), completion_tokens: z.number().int().min(0).optional(), cached_tokens: z.number().int().min(0).optional() }).optional(),
});

// Keep the wire contract in Groq's supported subset. Full limits/UUID validation stays in Zod.
export function groqJSONSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(groqJSONSchema);
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  const supported = ["type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "$defs", "$ref", "description"];
  const result = Object.fromEntries(Object.entries(node).filter(([key]) => supported.includes(key)).map(([key, v]) => [key, ["properties", "$defs"].includes(key) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, field]) => [name, groqJSONSchema(field)])) : groqJSONSchema(v)]));
  if ("const" in node) result.enum = [node.const];
  if (node.properties) { result.required = Object.keys(node.properties); result.additionalProperties = false; }
  return result;
}

export class GroqProvider implements AIProvider {
  readonly name = "groq";

  async generate<T>({ model, systemPrompt, input, schema }: { model: string; systemPrompt: string; input: unknown; schema: ZodType<T> }): Promise<AIResult<T>> {
    const env = getEnv();
    const wireSchema = groqJSONSchema(z.toJSONSchema(schema)) as Record<string, unknown>;
    const sourceIds = (input as { sources?: { id: string }[] })?.sources?.map(s => s.id);
    if (sourceIds?.length) {
      const constrainSources = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        for (const [key, value] of Object.entries(node)) {
          if (key === "sourceRefs") (node as Record<string, unknown>)[key] = { type: "array", items: { $ref: "#/$defs/scopeflow_source" } };
          else constrainSources(value);
        }
      };
      constrainSources(wireSchema);
      wireSchema.$defs = { ...(wireSchema.$defs as object ?? {}), scopeflow_source: { type: "string", enum: sourceIds } };
    }
    const request = {
      method: "POST",
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_completion_tokens: env.AI_MAX_OUTPUT_TOKENS,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: JSON.stringify(input) }],
        response_format: { type: "json_schema", json_schema: { name: "scopeflow_response", strict: true, schema: wireSchema } },
      }),
    };
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", request);
    if (response.status === 413) throw new ApiError("AI_CONTEXT_TOO_LARGE", "Groq의 요청 토큰 한도를 초과했습니다. 고객 조건을 생략하지 않고 응답 토큰 상한 또는 계정 한도를 조정해주세요.", 413);
    if (response.status === 429) throw new ApiError("AI_PROVIDER_RATE_LIMITED", "Groq 요청 한도에 도달했습니다. 잠시 후 다시 실행해주세요.", 429);
    if (!response.ok) {
      const rejected = await response.json().catch(() => null) as { error?: { failed_generation?: string } } | null;
      throw new AIResponseError("AI_PROVIDER_ERROR", `AI 제공자 요청이 실패했습니다. (${response.status})`, rejected?.error?.failed_generation ?? "", 502);
    }
    const rawEnvelope = await response.text();
    let payload;
    try { payload = groqResponseSchema.parse(JSON.parse(rawEnvelope)); } catch { throw new AIResponseError("AI_INVALID_RESPONSE", "AI 응답 형식을 확인할 수 없습니다.", rawEnvelope); }
    let parsed: unknown;
    try { parsed = JSON.parse(payload.choices[0].message.content); } catch { throw new AIResponseError("AI_INVALID_RESPONSE", "AI가 올바른 JSON을 반환하지 않았습니다.", payload.choices[0].message.content); }
    // Parseable but invalid candidates stay editable; the common validator never promotes them.
    return { data: parsed as T, rawResponse: payload.choices[0].message.content, inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0, cachedTokens: payload.usage?.cached_tokens ?? 0, usageKnown: payload.usage?.prompt_tokens !== undefined && payload.usage?.completion_tokens !== undefined };
  }
}
