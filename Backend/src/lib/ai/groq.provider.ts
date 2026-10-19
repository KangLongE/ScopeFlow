import { z, type ZodType } from "zod";
import { getEnv } from "@/lib/env";
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
    const requirementIds = (input as { confirmedRequirements?: { id: string }[] })?.confirmedRequirements?.map(r => r.id) ?? [];
    const existingIds = (input as { existingRequirements?: { id: string }[] })?.existingRequirements?.map(r => r.id) ?? [];
    if (sourceIds?.length) {
      const constrainSources = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        for (const [key, value] of Object.entries(node)) {
          if (key === "sourceRefs") (node as Record<string, unknown>)[key] = { type: "array", items: { $ref: "#/$defs/scopeflow_source" } };
          else if (key === "requirementId" && requirementIds.length) (node as Record<string, unknown>)[key] = { type: "string", enum: requirementIds, description: "Raw confirmed requirement UUID, never the requirement: source reference." };
          else if (key === "existingRequirementId") (node as Record<string, unknown>)[key] = { anyOf: [...(existingIds.length ? [{ type: "string", enum: existingIds }] : []), { type: "null" }] };
          else if (key === "features" && value && typeof value === "object") { (value as Record<string, unknown>).description = "At least one grounded, implementable feature is required. Never return an empty array for a concrete website request. Explain uncertainty separately in reviewNotes."; constrainSources(value); }
          else constrainSources(value);
        }
      };
      constrainSources(wireSchema);
      wireSchema.$defs = { ...(wireSchema.$defs as object ?? {}), scopeflow_source: { type: "string", enum: sourceIds } };
    }
    const inputJSON = JSON.stringify(input);
    const request = {
      method: "POST",
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_completion_tokens: env.AI_MAX_OUTPUT_TOKENS,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: inputJSON }],
        response_format: { type: "json_schema", json_schema: { name: "scopeflow_response", strict: true, schema: wireSchema } },
      }),
    };
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", request);
    if (!response.ok) {
      const rejected = await response.json().catch(() => null) as { error?: { failed_generation?: string; code?: string; type?: string; message?: string } } | null;
      if ([413, 429].includes(response.status)) {
        const message = rejected?.error?.message ?? "";
        const dimension = /tokens per day|\bTPD\b/i.test(message) ? "tokens_per_day" : /tokens per minute|\bTPM\b/i.test(message) ? "tokens_per_minute" : /requests per|\bRPM\b|\bRPD\b/i.test(message) ? "request_rate" : /context|maximum.*tokens/i.test(message) ? "context_window" : "unknown";
        const diagnostic = { event: "groq_request_rejected", status: response.status, model, dimension, inputBytes: Buffer.byteLength(inputJSON, "utf8"), requestBytes: Buffer.byteLength(request.body, "utf8"), sourceCount: sourceIds?.length ?? 0, maxCompletionTokens: env.AI_MAX_OUTPUT_TOKENS, limit: message.match(/limit\s*[:=]?\s*([\d,]+)/i)?.[1]?.replaceAll(",", "") ?? null, requested: message.match(/requested\s*[:=]?\s*([\d,]+)/i)?.[1]?.replaceAll(",", "") ?? null, retryAfterSeconds: /^\d+$/.test(response.headers.get("retry-after") ?? "") ? response.headers.get("retry-after") : null };
        console.warn(JSON.stringify(diagnostic));
        const hint = dimension === "tokens_per_minute" ? "분당 토큰 한도" : dimension === "tokens_per_day" ? "일일 토큰 한도" : dimension === "request_rate" ? "요청 횟수 한도" : dimension === "context_window" ? "모델 입력·출력 길이 한도" : "요청 한도 (서버 진단 기록 확인 필요)";
        throw new AIResponseError(response.status === 413 ? "AI_CONTEXT_TOO_LARGE" : "AI_PROVIDER_RATE_LIMITED", `Groq ${hint}에 도달했습니다. 고객 조건은 생략하지 않았습니다. 응답 토큰 상한·계정 한도를 확인한 뒤 직접 재실행하거나 수동 검토를 계속해주세요.`, JSON.stringify(diagnostic), response.status);
      }
      const failure = rejected?.error?.code === "json_validate_failed" || response.status === 422
        ? { code: "AI_INVALID_RESPONSE", message: "AI가 요구된 응답 형식을 완성하지 못했습니다. 기존 원문과 검토 내용은 보존됩니다. 수동 검토를 계속하거나 새 실행 비용을 확인한 뒤 직접 재시도해주세요." }
        : response.status === 400 ? { code: "AI_PROVIDER_BAD_REQUEST", message: "AI 제공자가 요청 형식을 수락하지 않았습니다. 모델·응답 스키마 설정 확인이 필요합니다. 같은 요청을 반복 실행하기보다 수동 검토를 계속해주세요." }
        : [401, 403].includes(response.status) ? { code: "AI_PROVIDER_AUTH_ERROR", message: "AI 제공자 인증 또는 모델 접근 권한을 확인해야 합니다. 관리자 설정을 확인하는 동안 수동 검토를 계속할 수 있습니다." }
        : response.status === 404 ? { code: "AI_PROVIDER_MODEL_UNAVAILABLE", message: "AI 모델 또는 요청 경로를 찾을 수 없습니다. 관리자 설정을 확인한 뒤 다시 실행하거나 수동 검토를 계속해주세요." }
        : response.status >= 500 ? { code: "AI_PROVIDER_UNAVAILABLE", message: "AI 제공자에 일시적인 문제가 있습니다. 잠시 후 새 실행 비용을 확인해 직접 재시도하거나 수동 검토를 계속해주세요." }
        : { code: "AI_PROVIDER_ERROR", message: "AI 제공자 요청이 실패했습니다. 기존 내용은 보존됩니다. 실행 기록을 확인하거나 수동 검토를 계속해주세요." };
      throw new AIResponseError(failure.code, failure.message, rejected?.error?.failed_generation ?? "", 502);
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
