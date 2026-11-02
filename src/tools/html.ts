const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

// Characters unsafe in HTML text/attributes. Matches "<" in "a<b"; rejects "abc".
// Try it: https://regex101.com/?flavor=javascript&regex=%5B%26%3C%3E%22%5D&flags=g&testString=%3C%0Aa%3Cb%0Aabc
const UNSAFE_HTML_PATTERN = /[&<>"]/g;

export const escapeHtml = (text: string): string =>
  text.replace(UNSAFE_HTML_PATTERN, (char) => HTML_ESCAPES[char] ?? char);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// HTML entity: named, decimal or hex. Matches "&amp;", "&#39;", "&#x2F;"; rejects "& amp;".
// Try it: https://regex101.com/?flavor=javascript&regex=%26%28%23x%5B0-9a-f%5D%2B%7C%23%5Cd%2B%7C%5Ba-z%5D%2B%29%3B&flags=gi&testString=%26amp%3B%0A%26%2339%3B%0A%26%23x2F%3B%0A%26%20amp%3B
const ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

// Any HTML tag. Matches "<span class=\"a\">", "</p>"; rejects "a < b".
// Try it: https://regex101.com/?flavor=javascript&regex=%3C%5B%5E%3E%5Cs%5D%5B%5E%3E%5D%2A%3E&flags=g&testString=%3Cspan%20class%3D%22a%22%3E%0A%3C%2Fp%3E%0Aa%20%3C%20b
const TAG_PATTERN = /<[^>\s][^>]*>/g;

// Runs of whitespace. Matches "  \n  "; rejects "a".
// Try it: https://regex101.com/?flavor=javascript&regex=%5Cs%2B&flags=g&testString=%20%20%5Cn%20%20%0Aa
const WHITESPACE_PATTERN = /\s+/g;

const HEX_PREFIX = "#x";
const HEX_RADIX = 16;

const decodeEntity = (entity: string, body: string): string => {
  if (body.startsWith(HEX_PREFIX) || body.startsWith(HEX_PREFIX.toUpperCase())) {
    return String.fromCodePoint(parseInt(body.slice(HEX_PREFIX.length), HEX_RADIX));
  }
  if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
  return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
};

/** Plain text of an HTML fragment: tags dropped, entities decoded, whitespace collapsed. */
export const htmlToText = (html: string): string =>
  html.replace(TAG_PATTERN, "").replace(ENTITY_PATTERN, decodeEntity).replace(WHITESPACE_PATTERN, " ").trim();
