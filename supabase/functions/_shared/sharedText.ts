/** Remove known private identifiers from prose on a scoped share page. */
export function privateName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${Array.from(parts.at(-1) ?? "")[0] ?? ""}.`;
}

export function redactSharedText(value: string, playerName: string, teamName: string): string {
  let text = value;
  const parts = playerName.trim().split(/\s+/);
  const replacements: [string, string][] = [
    [playerName.trim(), privateName(playerName)],
    [teamName.trim(), "the team"],
    ...(parts.length > 1 ? [[parts.at(-1)!, `${Array.from(parts.at(-1)!)[0]}.`] as [string, string]] : []),
  ];
  for (const [term, replacement] of replacements) {
    if (!term) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), replacement);
  }
  return text;
}

/** Redact legacy share payloads, whose coach-written text spans nested fields. */
export function redactSharedValue(value: unknown, playerName: string, teamName: string): unknown {
  if (typeof value === "string") return redactSharedText(value, playerName, teamName);
  if (Array.isArray(value)) return value.map((item) => redactSharedValue(item, playerName, teamName));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, redactSharedValue(item, playerName, teamName)]));
  return value;
}
