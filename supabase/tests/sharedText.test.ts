import { privateName, redactSharedText, redactSharedValue } from "../functions/_shared/sharedText.ts";

const equal = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

Deno.test("scoped share text removes known surname and team identity", () => {
  equal(privateName("Maya Curry"), "Maya C.");
  equal(redactSharedText("Maya Curry of Riverside Rockets stayed balanced. Curry finished tall.",
    "Maya Curry", "Riverside Rockets"),
  "This detail is hidden on shared links to protect privacy.");
  equal(redactSharedText("Maya Curry of Riverside Rockets stayed balanced.", "Maya Curry", "Riverside Rockets"),
    "Maya C. of the team stayed balanced.");
});

Deno.test("legacy shared report text is redacted in nested coach notes", () => {
  const result = redactSharedValue({ summary: "Maya Curry", notes: [{ text: "Riverside Rockets helped Curry" }] },
    "Maya Curry", "Riverside Rockets") as { summary: string; notes: { text: string }[] };
  equal(result.summary, "Maya C.");
  equal(result.notes[0].text, "This detail is hidden on shared links to protect privacy.");
});

Deno.test("non-ASCII surnames are redacted without changing longer words", () => {
  equal(redactSharedText("Álvarez swung. The Alvarez family watched.", "José Álvarez", "Riverside"),
    "This detail is hidden on shared links to protect privacy.");
  equal(redactSharedText("The Alvarez family watched.", "José Álvarez", "Riverside"),
    "This detail is hidden on shared links to protect privacy.");
});

Deno.test("supplementary Unicode surname keeps one complete code point", () => {
  equal(privateName("Maya 𠀀son"), "Maya 𠀀.");
  equal(redactSharedText("Maya 𠀀son swung", "Maya 𠀀son", "Riverside"), "Maya 𠀀. swung");
});

Deno.test("every component of a multi-word surname is hidden in shared prose", () => {
  equal(privateName("John Doe Smith"), "John S.");
  equal(redactSharedText("John Doe Smith swung. Doe and Smith reviewed it.", "John Doe Smith", "Riverside"),
    "This detail is hidden on shared links to protect privacy.");
});

Deno.test("an isolated surname matching a coaching term withholds ambiguous prose", () => {
  equal(redactSharedText("john head kept his head still. Head watched the ball.", "John Head", "Hitters"),
    "This detail is hidden on shared links to protect privacy.");
  equal(redactSharedText("The hitters kept the bat level.", "Maya Curry", "Hitters"),
    "This detail is hidden on shared links to protect privacy.");
  equal(redactSharedText("The Currys watched the Rockets.", "Maya Curry", "Riverside Rockets"),
    "This detail is hidden on shared links to protect privacy.");
});
