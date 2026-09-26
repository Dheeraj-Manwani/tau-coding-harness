/**
 * The fractal-noise kernel behind every jagged, crackling stroke in the product.
 *
 * Extracted verbatim from `components/ui/electric-border.tsx` so the landing
 * page's lightning and the composer's border are literally the same math — a
 * bolt drawn on the marketing page and a bolt drawn around the MAX composer
 * have to look like the same phenomenon. `ElectricBorder` imports from here.
 *
 * These are pure functions of their arguments (no state, no allocation), so
 * they are safe to call once per sample inside a rAF draw loop.
 */

/** Deterministic hash-noise in roughly (-1, 1). Not uniform — that's fine. */
export function random(x: number): number {
  return (Math.sin(x * 12.9898) * 43758.5453) % 1;
}

/** Value noise on a 2D lattice with smoothstep interpolation. */
export function noise2D(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;

  const a = random(i + j * 57);
  const b = random(i + 1 + j * 57);
  const c = random(i + (j + 1) * 57);
  const d = random(i + 1 + (j + 1) * 57);

  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);

  return (
    a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy
  );
}

/**
 * Summed octaves of `noise2D`, walked through `time` on the second axis so the
 * result animates. `baseFlatness` scales down the first (loudest) octave, which
 * is how the border keeps its overall shape while still crackling.
 */
export function octavedNoise(
  x: number,
  octaves: number,
  lacunarity: number,
  gain: number,
  baseAmplitude: number,
  baseFrequency: number,
  time: number,
  seed: number,
  baseFlatness: number,
): number {
  let y = 0;
  let amplitude = baseAmplitude;
  let frequency = baseFrequency;

  for (let i = 0; i < octaves; i++) {
    let octaveAmplitude = amplitude;
    if (i === 0) {
      octaveAmplitude *= baseFlatness;
    }
    y +=
      octaveAmplitude *
      noise2D(frequency * x + seed * 100, time * frequency * 0.3);
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return y;
}
