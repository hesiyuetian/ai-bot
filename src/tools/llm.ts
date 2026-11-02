import { describeError } from "./async.ts";
import { env } from "./channels.ts";

export type CompletionRequest = {
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens: number;
};

export type LlmProvider = {
  /** Shown in logs and in the push footer, e.g. "Claude (claude-sonnet-5-5)". */
  readonly name: string;
  readonly complete: (request: CompletionRequest) => Promise<string>;
};

const TIMEOUT_MS = 180_000;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

// Trailing slashes of a base URL. Matches "/" in "https://api.x.com/v1/"; rejects "https://api.x.com/v1".
// Try it: https://regex101.com/?flavor=javascript&regex=%5C%2F%2B%24&flags=&testString=https%3A%2F%2Fapi.x.com%2Fv1%2F%0Ahttps%3A%2F%2Fapi.x.com%2Fv1
const TRAILING_SLASHES_PATTERN = /\/+$/;

type AnthropicResponse = {
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly error?: { readonly message?: string };
};

type OpenAiResponse = {
  readonly choices?: readonly { readonly message?: { readonly content?: string | null } }[];
  readonly error?: { readonly message?: string };
};

const postJson = async <T>(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; body: T }> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, body: (await response.json()) as T };
};

const anthropicProvider = (apiKey: string, model: string): LlmProvider => ({
  name: `Claude (${model})`,
  complete: async ({ system, prompt, maxTokens }) => {
    const { status, body } = await postJson<AnthropicResponse>(
      ANTHROPIC_URL,
      { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] },
    );
    const text = (body.content ?? []).map((block) => block.text ?? "").join("");
    if (!text) throw new Error(body.error?.message ?? `HTTP ${status}，没有返回内容`);
    return text;
  },
});

/** Works with OpenAI and any OpenAI-compatible endpoint (set OPENAI_BASE_URL). */
const openAiProvider = (apiKey: string, model: string, baseUrl: string): LlmProvider => ({
  name: `ChatGPT (${model})`,
  // No token limit: reasoning models spend part of it on hidden reasoning and may then return nothing.
  complete: async ({ system, prompt }) => {
    const { status, body } = await postJson<OpenAiResponse>(
      `${baseUrl.replace(TRAILING_SLASHES_PATTERN, "")}/chat/completions`,
      { Authorization: `Bearer ${apiKey}` },
      { model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] },
    );
    const text = body.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error(body.error?.message ?? `HTTP ${status}，没有返回内容`);
    return text;
  },
});

/**
 * Providers with an API key configured, in the order to try them. Claude goes first unless
 * AI_PROVIDER=openai; the other one serves as a fallback.
 */
export const configuredProviders = (): LlmProvider[] => {
  const anthropicKey = env("ANTHROPIC_API_KEY");
  const openAiKey = env("OPENAI_API_KEY");
  const providers = [
    ...(anthropicKey ? [anthropicProvider(anthropicKey, env("ANTHROPIC_MODEL") ?? DEFAULT_ANTHROPIC_MODEL)] : []),
    ...(openAiKey
      ? [openAiProvider(openAiKey, env("OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL, env("OPENAI_BASE_URL") ?? DEFAULT_OPENAI_BASE_URL)]
      : []),
  ];
  return env("AI_PROVIDER") === "openai" ? providers.reverse() : providers;
};

/**
 * Runs `use` with each provider in turn until one succeeds, so a failing Claude call falls back to ChatGPT.
 * `use` should throw when the answer is unusable, not only when the request fails.
 */
export const withFirstWorkingProvider = async <T>(
  providers: readonly LlmProvider[],
  use: (provider: LlmProvider) => Promise<T>,
): Promise<{ readonly result: T; readonly provider: LlmProvider }> => {
  const [provider, ...fallbacks] = providers;
  if (!provider) throw new Error("没有可用的 AI 服务");
  try {
    return { result: await use(provider), provider };
  } catch (error: unknown) {
    console.warn(`⚠️ ${provider.name} 调用失败: ${describeError(error)}`);
    return withFirstWorkingProvider(fallbacks, use);
  }
};

/** The JSON object in an AI answer, tolerating code fences or chatter around it. */
export const extractJson = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("回答里没有 JSON");
  return JSON.parse(text.slice(start, end + 1));
};
