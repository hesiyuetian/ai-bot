const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_OFFSET = "+08:00";

/** Today's date in Beijing time as "YYYY/MM/DD", for display. */
export const todayInShanghai = (): string =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/** Today's date in Beijing time as "YYYY-MM-DD". */
export const shanghaiDate = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: SHANGHAI_TIME_ZONE }).format(now);

/** The instant of "HH:mm" Beijing time on the given "YYYY-MM-DD". */
export const shanghaiInstant = (date: string, time: string): Date => new Date(`${date}T${time}:00${SHANGHAI_OFFSET}`);
