import { createHash } from "node:crypto";

export type InstrumentReading = {
  recordKey: string;
  timestamp: string | null;
  field: string;
  value: string;
  unit: string;
  definitionVersion: string;
  warnings: string[];
};
export type InstrumentEnvelope = {
  playerId: string; consentId: string; sessionId: string | null; importedBy: string;
  fileSha256: string; format: "csv" | "json"; provider: string;
  deviceType: "bat_sensor" | "radar" | "ball_flight" | "facility_export" | "other";
  deviceModel: string; firmware: string; warnings: string[];
  readings: InstrumentReading[];
};

const REQUIRED = ["record_key", "device_timestamp", "field", "value", "unit", "definition_version"];
const ALLOWED = new Set([...REQUIRED, "recordKey", "timestamp", "definitionVersion"]);
const string = (value: unknown, name: string, max: number): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${name} must be a nonempty string of at most ${max} characters`);
  return value;
};
const timestamp = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value)
    || Number.isNaN(Date.parse(value)) || !/(Z|[+-]\d\d:\d\d)$/.test(value))
    throw new Error("device_timestamp must be an ISO timestamp with timezone or empty");
  return value;
};
const id = (value: string, name: string): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new Error(`${name} must be a UUID`);
  return value;
};

/** RFC 4180-style parser; quoted commas, quotes, and newlines are preserved. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, ended = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; ended = true; }
      else field += c;
    } else if (ended) {
      if (c === ',') { row.push(field); field = ""; ended = false; }
      else if (c === "\n" || c === "\r") {
        row.push(field); rows.push(row); row = []; field = ""; ended = false;
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else throw new Error("invalid CSV after closing quote");
    } else if (c === '"') {
      if (field) throw new Error("invalid CSV quote");
      quoted = true;
    } else if (c === ',') { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      row.push(field); rows.push(row); row = []; field = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (quoted) throw new Error("unterminated CSV quote");
  if (field || row.length || ended) { row.push(field); rows.push(row); }
  return rows;
}

export function parseInstrumentReadings(bytes: Buffer, format: "csv" | "json"): InstrumentReading[] {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  let raw: Record<string, unknown>[];
  if (format === "csv") {
    const rows = parseCsv(text).filter((row) => row.some((cell) => cell !== ""));
    const header = rows.shift();
    if (!header || new Set(header).size !== header.length || REQUIRED.some((field) => !header.includes(field)))
      throw new Error("CSV requires unique record_key, device_timestamp, field, value, unit, definition_version headers");
    if (header.some((field) => !REQUIRED.includes(field)))
      throw new Error("CSV contains unsupported columns; convert every source field to a reading so none are discarded");
    raw = rows.map((row, i) => {
      if (row.length !== header.length) throw new Error(`CSV row ${i + 2} has the wrong column count`);
      return Object.fromEntries(header.map((key, index) => [key, row[index]]));
    });
  } else {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      Object.keys(parsed).some((key) => key !== "readings"))
      throw new Error("JSON contains unsupported top-level fields; source metadata must be supplied explicitly");
    const items = Array.isArray(parsed) ? parsed :
      parsed && typeof parsed === "object" ? (parsed as { readings?: unknown }).readings : null;
    if (!Array.isArray(items) || items.some((item) => !item || typeof item !== "object" || Array.isArray(item)))
      throw new Error("JSON must contain a readings array of objects");
    raw = items as Record<string, unknown>[];
  }
  if (raw.length < 1 || raw.length > 2000) throw new Error("import requires 1–2000 readings");
  const seen = new Set<string>();
  return raw.map((item, index) => {
    if (Object.keys(item).some((key) => !ALLOWED.has(key)))
      throw new Error(`row ${index + 1} contains unsupported source fields; convert each to a reading`);
    const get = (snake: string, camel: string) => item[snake] ?? item[camel];
    const recordKey = string(get("record_key", "recordKey"), `row ${index + 1} record_key`, 120);
    const field = string(item.field, `row ${index + 1} field`, 120);
    const value = string(item.value, `row ${index + 1} value`, 200);
    const unit = string(item.unit, `row ${index + 1} unit`, 40);
    const definitionVersion = string(get("definition_version", "definitionVersion"),
      `row ${index + 1} definition_version`, 80);
    const key = `${recordKey}\0${field}`;
    if (seen.has(key)) throw new Error(`duplicate record_key and field at row ${index + 1}`);
    seen.add(key);
    return { recordKey, timestamp: timestamp(get("device_timestamp", "timestamp")),
      field, value, unit, definitionVersion, warnings: [] };
  });
}

export function buildInstrumentEnvelope(bytes: Buffer, format: "csv" | "json", meta: {
  playerId: string; consentId: string; sessionId?: string; importedBy: string;
  provider: string; deviceType: InstrumentEnvelope["deviceType"];
  deviceModel: string; firmware: string;
}): InstrumentEnvelope {
  if (!bytes.length || bytes.length > 2_000_000) throw new Error("file must be 1 byte–2 MB");
  if (!["bat_sensor", "radar", "ball_flight", "facility_export", "other"].includes(meta.deviceType))
    throw new Error("invalid device type");
  const readings = parseInstrumentReadings(bytes, format);
  return {
    playerId: id(meta.playerId, "playerId"), consentId: id(meta.consentId, "consentId"),
    sessionId: meta.sessionId ? id(meta.sessionId, "sessionId") : null,
    importedBy: id(meta.importedBy, "importedBy"),
    fileSha256: createHash("sha256").update(bytes).digest("hex"), format,
    provider: string(meta.provider, "provider", 120), deviceType: meta.deviceType,
    deviceModel: string(meta.deviceModel, "deviceModel", 120),
    firmware: string(meta.firmware, "firmware", 120), warnings: [], readings,
  };
}
