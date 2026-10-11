/** Descriptive values only from released, exact-version external mappings. */
export function labDistributions(report) {
  if (!report || report.truncated) return [];
  const imports = new Map((report.imports ?? []).map((item) => [item.id, item]));
  const groups = new Map();
  for (const reading of report.readings ?? []) {
    const source = imports.get(reading.importId);
    if (!source) continue;
    for (const value of reading.normalized ?? []) {
      const number = Number(value.value);
      if (!Number.isFinite(number)) continue;
      const key = value.mappingId;
      const group = groups.get(key) ?? { mappingId: key, mappingVersion: value.mappingVersion,
        definition: value.definition, definitionVersion: value.definitionVersion,
        unit: value.unit, minimum: Math.max(5, Number(value.minimumSample) || Infinity),
        source: `${source.provider} · ${source.deviceModel} · firmware ${source.firmware}`,
        points: [] };
      group.points.push({ number, date: reading.deviceTimestamp ?? source.importedAt });
      groups.set(key, group);
    }
  }
  const quantile = (sorted, fraction) => {
    const pos = (sorted.length - 1) * fraction;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  return [...groups.values()].map((group) => {
    const sorted = group.points.map((item) => item.number).sort((a, b) => a - b);
    const dates = group.points.map((item) => item.date).filter(Boolean).sort();
    return { ...group, count: sorted.length, from: dates[0] ?? null,
      through: dates.at(-1) ?? null, stats: sorted.length >= group.minimum
        ? { median: quantile(sorted, .5), q1: quantile(sorted, .25), q3: quantile(sorted, .75) }
        : null };
  });
}
