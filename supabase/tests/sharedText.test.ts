import { privateName, redactSharedText, redactSharedValue } from "../functions/_shared/sharedText.ts";

const equal = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

Deno.test("scoped share text removes known surname and team identity", () => {
  equal(privateName("Maya Curry"), "Maya C.");
  equal(redactSharedText("Maya Curry of Riverside Rockets stayed balanced. Curry finished tall.",
    "Maya Curry", "Riverside Rockets"),
  "Maya C. of the team stayed balanced. C. finished tall.");
});

Deno.test("legacy shared report text is redacted in nested coach notes", () => {
  const result = redactSharedValue({ summary: "Maya Curry", notes: [{ text: "Riverside Rockets helped Curry" }] },
    "Maya Curry", "Riverside Rockets") as { summary: string; notes: { text: string }[] };
  equal(result.summary, "Maya C.");
  equal(result.notes[0].text, "the team helped C.");
});

Deno.test("non-ASCII surnames are redacted without changing longer words", () => {
  equal(redactSharedText("Álvarez swung. The Alvarez family watched.", "José Álvarez", "Riverside"),
    "Á. swung. The Alvarez family watched.");
});

Deno.test("supplementary Unicode surname keeps one complete code point", () => {
  equal(privateName("Maya 𠀀son"), "Maya 𠀀.");
  equal(redactSharedText("Maya 𠀀son swung", "Maya 𠀀son", "Riverside"), "Maya 𠀀. swung");
});
