// Optional actual Deno verification: deno test --no-config --no-remote this-file
// No permissions, packages, network, or production environment reads required.
import { flagCases } from "../../src/services/config/analysisFlags.cases.ts";
import { parseAnalysisFlags, readAnalysisFlags } from "../../supabase/functions/_shared/analysisFlags.ts";

for (const row of flagCases) {
  Deno.test(`analysis flags parity: ${row.name}`, () => {
    for (const parse of [() => parseAnalysisFlags(row.config), () => readAnalysisFlags(key => row.config[key])]) {
      let actual;
      try { actual = parse(); } catch {
        if (row.expected === null) continue;
        throw new Error(`Unexpected rejection: ${row.name}`);
      }
      if (row.expected === null || JSON.stringify(actual) !== JSON.stringify(row.expected)) {
        throw new Error(`Unexpected result: ${row.name}`);
      }
    }
  });
}
