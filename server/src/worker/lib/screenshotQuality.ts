export interface ScreenshotPixelStats {
  mean: number;
  variance: number;
  range: number;
  buckets: number;
}

/**
 * Reject nearly solid frames before they replace a project's last good cover.
 *
 * JPEG compression introduces a little noise even into a blank page, so none
 * of these checks can use exact equality. A real first fold normally clears
 * all three thresholds comfortably; requiring two lets restrained designs
 * with a narrow palette still pass.
 */
export function screenshotLooksUseful(stats: ScreenshotPixelStats): boolean {
  const signals = [
    stats.variance >= 18,
    stats.range >= 28,
    stats.buckets >= 4,
  ];
  return signals.filter(Boolean).length >= 2;
}
