/** Remove known private identifiers from prose on a scoped share page. */
export function privateName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${Array.from(parts.at(-1) ?? "")[0] ?? ""}.`;
}

export function redactSharedText(value: string, playerName: string, teamName: string): string {
  let text = value;
  const parts = playerName.trim().split(/\s+/);
  const teamParts = teamName.trim().split(/\s+/);
  const wholeNames: [string, string][] = [
    ...(parts.length > 1 ? [[playerName.trim(), "\uE000"] as [string, string]] : []),
    ...(teamParts.length > 1 ? [[teamName.trim(), "\uE001"] as [string, string]] : []),
  ];
  for (const [term, replacement] of wholeNames) {
    if (!term) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), replacement);
  }
  // A lone surname or one-word team name can also be an ordinary coaching
  // word ("head", "ball", "hitters"). Context cannot distinguish them
  // reliably. Withhold this shared field rather than leak an identity or
  // rewrite a factual observation into nonsense.
  const ambiguous = [...(parts.length > 1 ? parts.slice(1) : parts), ...teamParts];
  const foldedText = text.normalize("NFD").replace(/\p{M}/gu, "");
  for (const term of ambiguous) {
    if (!term) continue;
    const escaped = term.normalize("NFD").replace(/\p{M}/gu, "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:s|es)?(?![\\p{L}\\p{N}])`, "iu").test(foldedText))
      return "This detail is hidden on shared links to protect privacy.";
  }
  return text.replaceAll("\uE000", privateName(playerName)).replaceAll("\uE001", "the team");
}

/** Redact legacy share payloads, whose coach-written text spans nested fields. */
export function redactSharedValue(value: unknown, playerName: string, teamName: string): unknown {
  if (typeof value === "string") return redactSharedText(value, playerName, teamName);
  if (Array.isArray(value)) return value.map((item) => redactSharedValue(item, playerName, teamName));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, redactSharedValue(item, playerName, teamName)]));
  return value;
}
