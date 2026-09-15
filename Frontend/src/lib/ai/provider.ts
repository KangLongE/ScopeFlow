import { z } from "zod";
import { prompts, type AIAction } from "./prompts";
import { AppError } from "../security";

export type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number; estimatedCost: number };
export const configuredProvider = () => (process.env.AI_PROVIDER || "openai").toLowerCase();
export const aiApiKey = () => configuredProvider() === "groq" ? process.env.GROQ_API_KEY : process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
export const aiBaseUrl = () => process.env.AI_BASE_URL || (configuredProvider() === "groq" ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1");
export const aiConfigured = () => Boolean(aiApiKey());
export const timeoutMs = () => Math.min(90000, Math.max(1000, Number(process.env.AI_TIMEOUT_MS) || 45000));
const envelopeSchema = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }) })).min(1), usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), prompt_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative().optional() }).optional() }).optional() });
export class ProviderError extends Error { constructor(message: string, public usage?: Usage) { super(message); } }

export interface AIProvider { generate(action: AIAction, model: string, input: unknown): Promise<{ result: unknown; usage: Usage }> }
export const provider: AIProvider = {
  async generate(action, model, input) {
    if (!aiConfigured()) throw new AppError("AI가 아직 연결되지 않았습니다. AI 설정을 확인하거나 직접 입력으로 진행해주세요.", 503);
    const prompt = prompts[action];
    const schema = z.toJSONSchema(prompt.schema, { target: "draft-7" });
    const body = JSON.stringify({ model, messages: [{ role: "system", content: prompt.instructions }, { role: "user", content: JSON.stringify(input) }], response_format: { type: "json_schema", json_schema: { name: `scopeflow_${action}`, strict: true, schema } }, max_completion_tokens: Math.min(12000, Math.max(512, Number(process.env.AI_MAX_OUTPUT_TOKENS) || 6000)) });
    const signal = AbortSignal.timeout(timeoutMs());
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await fetch(`${aiBaseUrl().replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${aiApiKey()}`, "Content-Type": "application/json" }, body, signal });
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 1) break;
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!response?.ok) throw new ProviderError(`Provider returned HTTP ${response?.status ?? "unknown"}`);
    const envelope = envelopeSchema.parse(await response.json());
    const inputTokens = envelope.usage?.prompt_tokens ?? 0, outputTokens = envelope.usage?.completion_tokens ?? 0;
    const cachedTokens = Math.min(inputTokens, envelope.usage?.prompt_tokens_details?.cached_tokens ?? 0);
    // Prices are configurable per model; this records an estimate, not a provider invoice.
    const configuredPrices = z.record(z.string(), z.tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative()])).parse(JSON.parse(process.env.AI_MODEL_PRICES || "{}"));
    const [inputPrice, cachedPrice, outputPrice] = configuredPrices[model] ?? [0, 0, 0];
    const usage = { inputTokens, outputTokens, cachedTokens, estimatedCost: ((inputTokens - cachedTokens) * inputPrice + cachedTokens * cachedPrice + outputTokens * outputPrice) / 1e6 };
    const choice = envelope.choices[0];
    if (choice.finish_reason !== "stop" || choice.message.refusal || !choice.message.content) throw new ProviderError("Provider refused or truncated output", usage);
    try { return { result: prompt.schema.parse(JSON.parse(choice.message.content)), usage }; }
    catch { throw new ProviderError("Provider returned invalid structured output", usage); }
  },
};
