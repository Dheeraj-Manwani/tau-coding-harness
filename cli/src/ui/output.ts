import chalk from "chalk";
import pc from "picocolors";

/** Brand violet — the same hue as the τ mark. */
const BRAND_VIOLET = "#8075E8";

/** Small wrappers so the colour scheme lives in one place. */
export const ui = {
  /** tau brand prefix. */
  brand: (s: string) => pc.magenta(pc.bold(s)),
  heading: (s: string) => pc.bold(pc.underline(s)),
  dim: (s: string) => pc.dim(s),
  ok: (s: string) => pc.green(s),
  warn: (s: string) => pc.yellow(s),
  err: (s: string) => pc.red(s),
  info: (s: string) => pc.cyan(s),
  accent: (s: string) => pc.magenta(s),
  bold: (s: string) => pc.bold(s),
  /** Brand violet — matches the τ mark; used for mode labels. */
  violet: (s: string) => chalk.hex(BRAND_VIOLET)(s),
};

export function printError(message: string): void {
  console.error(`${pc.red(pc.bold("✗"))} ${message}`);
}

export function printSuccess(message: string): void {
  console.log(`${pc.green(pc.bold("✓"))} ${message}`);
}

export function printInfo(message: string): void {
  console.log(`${pc.cyan("›")} ${message}`);
}
