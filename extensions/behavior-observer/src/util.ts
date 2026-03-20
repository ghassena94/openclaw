import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function shortHash(value: string): string {
  return sha256(value).slice(0, 16);
}

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const next = record[key];
      if (next !== undefined) {
        acc[key] = stableValue(next);
      }
      return acc;
    }, {});
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function slugifySegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

export function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
