/** Splits "a, b,，c" into ["a", "b", "c"]; tolerates spaces, Chinese commas and empty entries. */
export const splitList = (value: string | undefined): string[] =>
  [...new Set((value ?? "").replaceAll("，", ",").split(",").map((item) => item.trim()).filter(Boolean))];
