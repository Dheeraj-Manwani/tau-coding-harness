/** Shared pure math between `StormCanvas` (page background) and
 *  `BuildWeatherCanvas` (the build-loader card): both draw jagged lightning
 *  the same way, just at different scales and with different state machines
 *  around them, so only the path generator is worth sharing. */

export type Point = [number, number];

export const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Jagged bolt path via recursive midpoint displacement. */
export function genBolt(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  disp: number,
  depth: number,
): Point[] {
  let pts: Point[] = [
    [x0, y0],
    [x1, y1],
  ];
  for (let k = 0; k < depth; k++) {
    const next: Point[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      next.push(p, [
        (p[0] + q[0]) / 2 + rnd(-disp, disp),
        (p[1] + q[1]) / 2 + rnd(-disp * 0.25, disp * 0.25),
      ]);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
    disp *= 0.55;
  }
  return pts;
}

/** A bolt plus its branches, with a 0-1 life that decays after spawning. */
export interface Bolt {
  paths: Point[][];
  life: number;
}

/** A full bolt (main stroke + 1-3 branches) aimed at (x1, y1) from above. */
export function spawnBolt(x1: number, y1: number): Bolt {
  const x0 = x1 + rnd(-260, 260);
  const main = genBolt(x0, -10, x1, y1, 140, 7);
  const paths: Point[][] = [main];
  const branches = 1 + Math.floor(Math.random() * 3);
  for (let k = 0; k < branches; k++) {
    const m = main[Math.floor(rnd(0.15, 0.7) * main.length)]!;
    paths.push(genBolt(m[0], m[1], m[0] + rnd(-180, 180), m[1] + rnd(80, 220), 45, 5));
  }
  return { paths, life: 1 };
}

/** Draw accumulated bolts with the shared blue/white glow strokes. */
export function drawBolts(ctx: CanvasRenderingContext2D, bolts: Bolt[]) {
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const b of bolts) {
    const f = Math.max(0, b.life);
    b.paths.forEach((pts, i) => {
      const m = i === 0 ? 1 : 0.55;
      (
        [
          [14 * m, `rgba(59,130,246,${0.1 * f})`],
          [5 * m, `rgba(120,180,255,${0.32 * f})`],
          [1.6 * m, `rgba(235,244,255,${f})`],
        ] as [number, string][]
      ).forEach(([w, cc]) => {
        ctx.strokeStyle = cc;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(pts[0]![0], pts[0]![1]);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k]![0], pts[k]![1]);
        ctx.stroke();
      });
    });
  }
  ctx.globalCompositeOperation = "source-over";
}
