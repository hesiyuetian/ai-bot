const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

// Characters unsafe in HTML text/attributes. Matches "<" in "a<b"; rejects "abc".
// Try it: https://regex101.com/?flavor=javascript&regex=%5B%26%3C%3E%22%5D&flags=g&testString=%3C%0Aa%3Cb%0Aabc
const UNSAFE_HTML_PATTERN = /[&<>"]/g;

export const escapeHtml = (text: string): string =>
  text.replace(UNSAFE_HTML_PATTERN, (char) => HTML_ESCAPES[char] ?? char);
