const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";
const TARGET_LANGUAGE = "zh-CN";
const TIMEOUT_MS = 10_000;

// Any CJK unified ideograph. Matches "紫微斗数"; rejects "Local voice dictation".
// Try it: https://regex101.com/?flavor=javascript&regex=%5B%5Cu4e00-%5Cu9fff%5D&flags=&testString=%E7%B4%AB%E5%BE%AE%E6%96%97%E6%95%B0%0ALocal%20voice%20dictation
const CHINESE_PATTERN = /[一-鿿]/;

type TranslateSegment = readonly [string, ...unknown[]];
type TranslateResponse = readonly [readonly TranslateSegment[] | null, ...unknown[]];

const isChinese = (text: string): boolean => CHINESE_PATTERN.test(text);

const requestTranslation = async (text: string): Promise<string> => {
  const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: TARGET_LANGUAGE, dt: "t", q: text });
  const response = await fetch(`${TRANSLATE_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const [segments] = (await response.json()) as TranslateResponse;
  return (segments ?? []).map(([translated]) => translated).join("").trim();
};

export const translateToChinese = async (text: string): Promise<string> => {
  if (!text || isChinese(text)) return text;
  try {
    return (await requestTranslation(text)) || text;
  } catch (error: unknown) {
    console.warn(`⚠️ 翻译失败，保留原文: ${error instanceof Error ? error.message : error}`);
    return text;
  }
};
