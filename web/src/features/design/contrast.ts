/**
 * Whether a chosen accent can be seen against the page it will sit on.
 *
 * An accent the user picks is used exactly as picked: a brand colour two shades
 * off is, to the person who chose it, a different colour. The cost is that a
 * dark blue chosen for a dark app stays dark blue. Rather than quietly change
 * it, the picker says so and offers the nearest shade that does show.
 *
 * The numbers are WCAG's: 3:1 is what a filled control needs against the page
 * to be seen as a shape, and is the same line the server draws for the accents
 * tau picks itself (`SHAPE_CONTRAST` in `server/src/worker/design/palette.ts`).
 */
import type { CatalogStyle, DesignConfig, DesignMode, DesignSummary } from "./api";

export const ACCENT_CONTRAST = 3;

/** Stand-ins for a page whose style is not known yet. Every style's pages are close to these. */
const PLAIN_PAGE: Record<DesignMode, string> = { light: "#ffffff", dark: "#0d0d0f" };

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

function luminance([r, g, b]: Rgb): number {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The WCAG contrast ratio of two colours, 1 to 21. 1 when either is not a hex colour. */
export function contrast(a: string, b: string): number {
  const x = toRgb(a);
  const y = toRgb(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === rn ? ((gn - bn) / d + 6) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * The shade of `accent` nearest to it that shows against `page`: the same hue
 * and saturation, made only as much lighter (on a dark page) or darker (on a
 * light one) as it takes. Returned unchanged when it already shows.
 */
export function readableAccent(accent: string, page: string, target = ACCENT_CONTRAST): string {
  const rgb = toRgb(accent);
  const pageRgb = toRgb(page);
  if (!rgb || !pageRgb || contrast(accent, page) >= target) return accent.toLowerCase();

  const [h, s, l] = toHsl(rgb);
  // Away from the page: lighter on a dark one, darker on a light one.
  const end = luminance(pageRgb) < 0.2 ? 1 : 0;
  let near = l;
  let far = end;
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    if (contrast(toHex(fromHsl(h, s, mid)), page) >= target) far = mid;
    else near = mid;
  }
  return toHex(fromHsl(h, s, far));
}

export interface AccentWarning {
  accent: string;
  mode: DesignMode;
  /** The nearest shade that does show. */
  readable: string;
}

/**
 * What to warn about in a choice being made, or null when the accent shows —
 * or when it cannot be known yet whether it will.
 *
 * It can be known when the page can: the user chose light or dark, or the app
 * exists and its mode is settled by what it has and what is being changed. For
 * a new app left on Auto, tau picks the mode, and is told to pick the one the
 * colour stands out against.
 *
 * @param exactAccent  on a restyle, the accent the user chose earlier and the
 *                     app still has: it is kept exactly through the restyle, so
 *                     a change of mode can leave it unreadable too
 */
export function accentWarning(input: {
  value: DesignConfig;
  current?: DesignSummary | null;
  styles: readonly CatalogStyle[];
  exactAccent?: string;
}): AccentWarning | null {
  const { value, current, styles } = input;
  const accent = value.accent ?? (current ? input.exactAccent : undefined);
  if (!accent) return null;

  const style = styles.find((s) => s.key === (value.style ?? current?.style));
  if (style?.outlined) return null;

  const changingStyle = Boolean(current && value.style && value.style !== current.style);
  const mode: DesignMode | undefined =
    value.mode ?? (current ? (changingStyle ? style?.defaultMode : current.mode) : undefined);
  if (!mode) return null;

  const page = style?.page?.[mode] ?? PLAIN_PAGE[mode];
  if (contrast(accent, page) >= ACCENT_CONTRAST) return null;
  return { accent, mode, readable: readableAccent(accent, page) };
}
