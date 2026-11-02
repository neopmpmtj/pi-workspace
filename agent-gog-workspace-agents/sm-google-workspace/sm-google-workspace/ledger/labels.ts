/** First line only, collapsed and truncated: the full text stays in the session file. */
export function labelOf(text: string): string {
  const first = text.split("\n")[0].replace(/\s+/g, " ").trim();
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}
