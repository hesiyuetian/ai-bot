const TIMEOUT_MS = 10_000;

// Mainland China public holidays, kept up to date from State Council notices.
const HOLIDAY_URLS = [
  "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json",
  "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json",
] as const;

const SUNDAY = 0;
const SATURDAY = 6;

type HolidayFile = {
  readonly days: readonly { readonly date: string; readonly isOffDay: boolean }[];
};

const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * A-shares trade Monday to Friday except public holidays. Make-up working Saturdays (调休) stay closed,
 * so only the off days from the holiday file matter.
 */
export const isTradingDay = (date: string, offDays: ReadonlySet<string>): boolean => {
  const day = weekday(date);
  return day !== SUNDAY && day !== SATURDAY && !offDays.has(date);
};

const fetchHolidayFile = async (url: string): Promise<HolidayFile> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as HolidayFile;
};

const fetchOffDaysFrom = async (templates: readonly string[], year: string): Promise<Set<string>> => {
  const [template, ...fallbacks] = templates;
  if (!template) {
    console.warn("⚠️ 无法获取节假日数据，仅按周末判断交易日");
    return new Set();
  }
  try {
    const file = await fetchHolidayFile(template.replace("{year}", year));
    return new Set(file.days.filter((day) => day.isOffDay).map((day) => day.date));
  } catch (error: unknown) {
    console.warn(`⚠️ 节假日数据获取失败 (${template}): ${error instanceof Error ? error.message : error}`);
    return fetchOffDaysFrom(fallbacks, year);
  }
};

/** Public-holiday dates of the year; an empty set (weekends only) when every source fails. */
export const fetchOffDays = (year: string): Promise<Set<string>> => fetchOffDaysFrom(HOLIDAY_URLS, year);
