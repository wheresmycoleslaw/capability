import { createHash, randomUUID } from "node:crypto";

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input as object)) throw new TypeError("Cannot hash cyclic values");
    seen.add(input as object);
    if (Array.isArray(input)) return input.map(normalize);
    const record = input as Record<string, unknown>;
    return Object.keys(record).sort().reduce<Record<string, unknown>>((out, key) => {
      out[key] = normalize(record[key]);
      return out;
    }, {});
  };
  return JSON.stringify(normalize(value));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function makeId(prefix: string): string { return `${prefix}_${randomUUID()}`; }

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value as Readonly<T>;
}

export function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "capability";
}

export function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
