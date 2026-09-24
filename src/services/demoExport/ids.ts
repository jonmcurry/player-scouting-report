import { createHash } from "node:crypto";

/**
 * Deterministic fixture-local ids. A fixture id is a pure function of
 * (fixtureId, table, source id), so re-exporting the same curated selection
 * produces a byte-identical fixture.json - diffs between fixture versions
 * show only real content changes.
 *
 * These ids exist ONLY inside the fixture: demo.clone_real_fixture() assigns
 * fresh gen_random_uuid() ids per visitor clone and remaps every FK through
 * them, so no fixture id (and never a source id) ever appears as a live row
 * id. They're formatted as RFC 9562 version-8 (custom) UUIDs so they're
 * valid `uuid` values and visibly not v4 ids from production.
 */
export function fixtureUuid(fixtureId: string, table: string, sourceKey: string): string {
  const hex = createHash("sha256").update(`hitterloop-demo-fixture:v1\0${fixtureId}\0${table}\0${sourceKey}`).digest("hex");
  const b = hex.slice(0, 32).split("");
  b[12] = "8"; // version 8
  b[16] = ((parseInt(b[16]!, 16) & 0x3) | 0x8).toString(16); // RFC 4122/9562 variant
  const h = b.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export class IdRemapper {
  private readonly map = new Map<string, string>();
  private readonly used = new Set<string>();

  constructor(private readonly fixtureId: string) {}

  /** Fixture id for a source row; stable across calls, collision-checked. */
  idFor(table: string, sourceId: string): string {
    const key = `${table}\0${sourceId}`;
    const existing = this.map.get(key);
    if (existing) return existing;
    const id = fixtureUuid(this.fixtureId, table, sourceId);
    if (this.used.has(id)) throw new Error(`fixture id collision for ${table}/${sourceId}`);
    this.used.add(id);
    this.map.set(key, id);
    return id;
  }

  /** Fixture id if the source row was mapped, else null. */
  lookup(table: string, sourceId: string | null | undefined): string | null {
    if (!sourceId) return null;
    return this.map.get(`${table}\0${sourceId}`) ?? null;
  }

  teamPlaceholder(): string {
    return fixtureUuid(this.fixtureId, "team", "placeholder");
  }
}
