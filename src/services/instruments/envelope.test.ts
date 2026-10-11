import test from "node:test";
import assert from "node:assert/strict";
import { buildInstrumentEnvelope, parseInstrumentReadings } from "./envelope.js";

const meta = { playerId: "11111111-1111-4111-8111-111111111111",
  consentId: "22222222-2222-4222-8222-222222222222",
  importedBy: "33333333-3333-4333-8333-333333333333",
  provider: "Pilot device", deviceType: "bat_sensor" as const,
  deviceModel: "Model A", firmware: "1.2.3" };

test("CSV keeps original text, explicit unit and provider version, including quoted newline", () => {
  const bytes = Buffer.from('record_key,device_timestamp,field,value,unit,definition_version\r\n' +
    'r1,2026-10-11T12:00:00Z,"bat,speed","42\nraw",mph,v1\r\n');
  const envelope = buildInstrumentEnvelope(bytes, "csv", meta);
  assert.equal(envelope.readings[0]?.field, "bat,speed");
  assert.equal(envelope.readings[0]?.value, "42\nraw");
  assert.equal(envelope.readings[0]?.unit, "mph");
  assert.match(envelope.fileSha256, /^[a-f0-9]{64}$/);
  assert.equal(envelope.readings[0]?.definitionVersion, "v1");
});

test("JSON preserves unmapped fields and rejects missing units or ambiguous duplicate keys", () => {
  const json = Buffer.from(JSON.stringify({ readings: [{ recordKey: "1", field: "vendor_foo",
    value: "12.0", unit: "vendor_units", definitionVersion: "v2" }] }));
  assert.equal(parseInstrumentReadings(json, "json")[0]?.field, "vendor_foo");
  assert.throws(() => parseInstrumentReadings(Buffer.from('[{"recordKey":"1","field":"x","value":"1","definitionVersion":"v1"}]'), "json"), /unit/);
  assert.throws(() => parseInstrumentReadings(Buffer.from('[{"recordKey":"1","field":"x","value":"1","unit":"m","definitionVersion":"v1"},{"recordKey":"1","field":"x","value":"2","unit":"m","definitionVersion":"v1"}]'), "json"), /duplicate/);
});

test("timestamps require a timezone; hash changes with source bytes", () => {
  const a = Buffer.from('[{"recordKey":"1","timestamp":"2026-10-11T12:00:00Z","field":"x","value":"1","unit":"m","definitionVersion":"v1"}]');
  const b = Buffer.from(a.toString().replace('"1"', '"2"'));
  assert.notEqual(buildInstrumentEnvelope(a, "json", meta).fileSha256,
    buildInstrumentEnvelope(b, "json", meta).fileSha256);
  assert.throws(() => parseInstrumentReadings(Buffer.from('[{"recordKey":"1","timestamp":"2026-10-11T12:00:00","field":"x","value":"1","unit":"m","definitionVersion":"v1"}]'), "json"), /timezone/);
});

test("unknown source columns cannot be silently discarded", () => {
  assert.throws(() => parseInstrumentReadings(Buffer.from(
    "record_key,device_timestamp,field,value,unit,definition_version,extra\nr1,,speed,42,mph,v1,raw"), "csv"), /unsupported columns/);
  assert.throws(() => parseInstrumentReadings(Buffer.from(JSON.stringify([{ recordKey: "r1",
    field: "speed", value: "42", unit: "mph", definitionVersion: "v1", extra: "raw" }])), "json"),
  /unsupported source fields/);
  assert.throws(() => parseInstrumentReadings(Buffer.from(JSON.stringify({ readings: [{ recordKey: "r1",
    field: "speed", value: "42", unit: "mph", definitionVersion: "v1" }], unknownMeta: "raw" })), "json"),
  /unsupported top-level fields/);
});
