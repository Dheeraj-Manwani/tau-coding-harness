/**
 * Colour math for generated palettes.
 *
 * A palette is designed in OKLCH — lightness, chroma, hue — because that is the
 * space where "the same colour, lighter" and "the same lightness, another hue"
 * mean what they say: two swatches with equal L look equally light, which is
 * not true of HSL. It is *written* as hex, because the theme panel reads and
 * writes hex (`api/lib/themeEdit.ts`) and a palette in `oklch()` could be shown
 * there but not changed.
 *
 * Everything here is pure arithmetic on numbers; no dependencies.
 * Conversion matrices are Björn Ottosson's (https://bottosson.github.io/posts/oklab/).
 */

export interface Oklch {
  /** Lightness, 0 (black) to 1 (white). */
  l: number;
  /** Chroma, 0 (grey) to about 0.37 (the most saturated sRGB colours). */
  c: number;
  /** Hue in degrees, 0–360. */
  h: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function toGamma(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** OKLCH → linear sRGB. Components fall outside 0–1 when the colour is out of gamut. */
function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    g: -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    b: -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  };
}

function inGamut({ r, g, b }: Rgb): boolean {
  const e = 1e-4;
  return r >= -e && r <= 1 + e && g >= -e && g <= 1 + e && b >= -e && b <= 1 + e;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * OKLCH → `#rrggbb`.
 *
 * A colour sRGB cannot show is brought into range by lowering its chroma and
 * keeping its lightness and hue — the least visible of the possible fixes, and
 * the one that keeps contrast (which depends on lightness) where it was designed.
 */
export function oklchToHex(color: Oklch): string {
  const l = clamp01(color.l);
  let c = Math.max(0, color.c);
  const h = ((color.h % 360) + 360) % 360;

  let rgb = oklchToLinear({ l, c, h });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h }))) lo = mid;
      else hi = mid;
    }
    c = lo;
    rgb = oklchToLinear({ l, c, h });
  }

  const hex = (v: number) =>
    Math.round(clamp01(toGamma(clamp01(v))) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
}

/** `#rgb` or `#rrggbb` (alpha ignored) → 0–1 sRGB, or null if it is not a hex colour. */
function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1]!;
  if (s.length === 3 || s.length === 4) {
    s = [...s.slice(0, 3)].map((ch) => ch + ch).join("");
  } else if (s.length === 6 || s.length === 8) {
    s = s.slice(0, 6);
  } else {
    return null;
  }
  const n = parseInt(s, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Whether `value` is a hex colour this module can read. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && parseHex(value) !== null;
}

/** `#abc`, `abc123`, `#ABC123` → `#aabbcc` / `#abc123`; null for anything else. */
export function normalizeHex(value: unknown): string | null {
  if (!isHexColor(value)) return null;
  let hex = value.trim().toLowerCase().replace(/^#/, "");
  if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

/** `#rrggbb` → OKLCH. Throws on anything that is not a hex colour. */
export function hexToOklch(hex: string): Oklch {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Not a hex colour: ${hex}`);
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const l = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(a * a + bb * bb);
  const h = c < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

/** WCAG relative luminance of a hex colour. */
function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Not a hex colour: ${hex}`);
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

/** WCAG contrast ratio between two hex colours, 1 (none) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Move `color`'s lightness away from `against` until the two contrast by at
 * least `ratio`, changing nothing else. Returns the colour as given when it
 * already does. Used for text colours: the recipe says roughly how light a
 * muted label should be, this makes sure it can still be read.
 */
export function ensureContrast(color: Oklch, against: string, ratio: number): Oklch {
  if (contrast(oklchToHex(color), against) >= ratio) return color;
  const darker = luminance(against) > 0.18;
  let best = color;
  for (let step = 1; step <= 50; step++) {
    const l = clamp01(color.l + (darker ? -0.02 : 0.02) * step);
    best = { ...color, l };
    if (contrast(oklchToHex(best), against) >= ratio) return best;
    if (l === 0 || l === 1) break;
  }
  return best;
}

/**
 * The text colour to put on a filled surface: near-white or near-black,
 * whichever reads better, carrying a trace of the surface's own hue so it does
 * not look pasted on.
 */
export function readableOn(surface: string): string {
  const { h, c } = hexToOklch(surface);
  const tint = Math.min(c, 0.02);
  const light = oklchToHex({ l: 0.985, c: tint * 0.5, h });
  const dark = oklchToHex({ l: 0.17, c: tint, h });
  return contrast(light, surface) >= contrast(dark, surface) ? light : dark;
}
