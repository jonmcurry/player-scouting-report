/** Child names and swing imagery must never use Gemini's unpaid data terms.
 * Release configuration may set this only after billing is active and the
 * current provider terms have been reviewed. */
export function requirePaidGeminiService(value: string | undefined): void {
  if (value !== "true") {
    throw new Error("Gemini child-data processing is disabled until paid-service data terms are explicitly confirmed");
  }
}
