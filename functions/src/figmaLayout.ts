// The Figma layout a publish may carry (the studio's src/figmaLayout.ts describes it). It imports nothing, so
// src/figmaLayout.test.ts can run it on layouts the studio measured. Lengths are fractions of the hero's width.
export type LayoutKind = 'desktop' | 'mobile';
const MAX_BYTES = 4096;

// Each check returns the value it accepts, or throws an Error that names the field.
type Check = (value: unknown, path: string) => unknown;
const number = (min: number, max: number, whole = false): Check => (value, path) => {
  if (typeof value !== 'number' || !(value >= min && value <= max) || (whole && !Number.isInteger(value))) throw new Error(`${path} must be ${whole ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
  return value;
};
const oneOf = (...options: unknown[]): Check => (value, path) => {
  if (!options.includes(value)) throw new Error(`${path} must be one of: ${options.join(', ')}.`);
  return value;
};
const color: Check = (value, path) => {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${path} must be a #rrggbb colour.`);
  return value;
};
// Only these keys; the optional ones may be left out.
const object = (fields: Record<string, Check>, optional: string[] = []): Check => (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find(key => !Object.hasOwn(fields, key));
  if (unknown) throw new Error(`Unknown layout field: ${path}.${unknown}.`);
  return Object.fromEntries(Object.entries(fields).flatMap(([key, check]) => optional.includes(key) && input[key] === undefined ? [] : [[key, check(input[key], `${path}.${key}`)]]));
};

const length = number(0, 0.5);
const style = { size: length, lineHeight: length, letterSpacing: number(-0.05, 0.05), weight: oneOf(400, 700), color, lines: number(1, 20, true) };
const text = object({ gap: length, ...style });
const button = object({ gap: length, paddingX: length, paddingY: length, radius: length, fill: color, label: object(style) });
const stop = object({ color, at: number(0, 1) });
const backdrop: Check = (value, path) => {
  const type = (value as {type?: unknown} | null)?.type;
  if (type === 'solid') return object({ type: oneOf('solid'), color })(value, path);
  if (type !== 'linear') throw new Error(`${path}.type must be one of: solid, linear.`);
  return object({ type: oneOf('linear'), angle: number(0, 360), stops: (stops, at) => {
    if (!Array.isArray(stops) || stops.length < 2 || stops.length > 4) throw new Error(`${at} must have 2 to 4 stops.`);
    return stops.map((each, i) => stop(each, `${at}.${i}`));
  } })(value, path);
};
const copy = object({ x: number(0, 1.5), y: number(-1, 1.5), width: number(0, 1.5), align: oneOf('left', 'center') });
const frame = object({ backdrop, copy: (value, path) => value === null ? null : copy(value, path), eyebrow: text, headline: text, subtitle: text, button }, ['eyebrow', 'headline', 'subtitle', 'button']);

// The layout for exactly these frame kinds, with known keys only. Throws an Error that names the bad field.
export function validateLayout(value: unknown, kinds: readonly LayoutKind[]): Partial<Record<LayoutKind, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...kinds].sort().join()) {
    throw new Error(`layout must have the ${kinds.join(' and ')} frame${kinds.length > 1 ? 's' : ''}.`);
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_BYTES) throw new Error(`layout must be at most ${MAX_BYTES / 1024} KB.`);
  return Object.fromEntries(kinds.map(kind => [kind, frame((value as Record<string, unknown>)[kind], `layout.${kind}`)]));
}
