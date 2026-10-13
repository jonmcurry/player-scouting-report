/** Runtime guards for untrusted JSON; no coercion or defaults to pass. */
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)) ? value as Record<string, unknown> : {};
}
export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const integer = (value: unknown): value is number => Number.isSafeInteger(value);
export const index = (value: unknown): value is number => integer(value) && value >= 0;
export const fraction = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
export const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
