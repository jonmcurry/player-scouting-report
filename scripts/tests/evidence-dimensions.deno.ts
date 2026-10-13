// Optional native check: deno test --no-config --no-remote this-file
// No permissions, network, Node packages or media are needed.
import { decideClaim } from "../../src/services/development/evidence/decideClaim.ts";
import { INITIAL_EVIDENCE_TUPLE } from "../../src/services/development/evidenceRegistry.ts";
import { translateLegacyPhases } from "../../src/services/development/evidence/eventMapping.ts";
import { localiseEvents } from "../../src/services/development/evidence/events.ts";

Deno.test("pure evidence entry points fail closed in native Deno", async () => {
  const decision = await decideClaim({ tuple: INITIAL_EVIDENCE_TUPLE, subject: {}, metrics: {}, frameMap: {},
    concept: "contact", phase: "contact", supplied: {}, visibility: [], mode: "enforce" });
  if (decision.displayable || decision.enforceEligible || decision.reliability.status !== "unmeasured") {
    throw new Error("Unexpected production authorization");
  }
  const mapping = translateLegacyPhases({ "phases.load": { frame: 1, time_s: 1 } });
  if (mapping.events.load_start.status !== "not_produced") throw new Error("Invented load start");
  const events = await localiseEvents({ contact: { frame: 1, time_s: 1, method: "synthetic", confidence: "high" } }, {});
  if (events.impact_estimate.status !== "unmappable" || events.contact_confirmed.status !== "not_produced") {
    throw new Error("Invented frame identity or confirmed contact");
  }
});
