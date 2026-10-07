/**
 * An app's look, as the user chooses it.
 *
 * Three calls. The catalog is the list of styles to pick from, served by the
 * API so the web keeps no copy of the style library to fall out of date. A
 * project's design is what it looks like now. A restyle changes it: no job,
 * no credits, and — when the app is running — the preview restyles itself.
 *
 * The types mirror `server/src/worker/design/` (`catalog.ts`, `config.ts`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/src/lib/api-client";
import { projectKeys } from "@/src/features/project/api";
import { projectGithubKeys } from "@/src/features/project/github";

export type DesignMode = "light" | "dark";

export interface Dials {
  /** 1 symmetric and predictable … 10 asymmetric and surprising. */
  variance: number;
  /** 1 still … 10 lively. */
  motion: number;
  /** 1 airy … 10 packed. */
  density: number;
}

/**
 * What the user chose. Every part is optional: for a new app, anything left
 * out is tau's to decide; on a restyle, anything left out stays as it is.
 */
export interface DesignConfig {
  style?: string;
  /** `#rrggbb`. */
  accent?: string;
  mode?: DesignMode;
  /** A font pairing of the style: `"default"` or one of its options. */
  fonts?: string;
  dials?: Partial<Dials>;
  /** A DESIGN.md the user brought, whole. */
  designMd?: string;
}

export interface CatalogStyle {
  key: string;
  name: string;
  /** Other names the look goes by ("Neo-brutalism"). Often empty. */
  aka: string[];
  /** Which of the catalog's `groups` it is shown under. */
  group: string;
  look: string;
  suits: string;
  defaultMode: DesignMode;
  dials: Dials;
  /** The pairings on offer, the style's own first. */
  fonts: { key: string; label: string }[];
  swatch: {
    background: string;
    card: string;
    foreground: string;
    primary: string;
    border: string;
  };
  sampleAccent: string;
}

export type FeelPreset = "calm" | "balanced" | "bold";

/** A family of styles: `label` for a filter chip, `title` for a section heading. */
export interface StyleGroup {
  key: string;
  label: string;
  title: string;
}

export interface DesignCatalog {
  /**
   * False where the server builds new projects on the older templates, which
   * have no design step. The composer hides its picker there.
   */
  enabled: boolean;
  styles: CatalogStyle[];
  /** The families the styles are shown in, in order. */
  groups: StyleGroup[];
  feelPresets: Record<FeelPreset, Dials>;
  suggestedAccents: string[];
}

/** How an app looks now, read from its `.tau/DESIGN.md`. */
export interface DesignSummary {
  style: string;
  styleName: string;
  accent: string;
  mode: DesignMode;
  dials: Dials;
  fonts: string;
  fontsLabel: string;
  imported: boolean;
}

export interface ProjectDesignResponse {
  /** Null for an app tau did not design; such an app cannot be restyled here. */
  design: DesignSummary | null;
  /** The parts of the design the user chose themselves. */
  chosen: Omit<DesignConfig, "designMd"> & { imported: boolean };
  restylable: boolean;
}

export interface RestyleResponse {
  applied: true;
  design: DesignSummary | null;
  chosen: ProjectDesignResponse["chosen"];
  fontsInstalled: boolean;
  skipped: string[];
  headSequence: number;
  /** False when the app was not running: the change shows when the preview next starts. */
  live: boolean;
}

export const designKeys = {
  catalog: ["design", "catalog"] as const,
  project: (id: string) => ["project", id, "design"] as const,
};

/** Where a style's preview thumbnail lives (`server/scripts/design-previews.ts` renders them). */
export function stylePreviewUrl(key: string): string {
  return `/design/${key}.jpg`;
}

/**
 * The styles a search matches: every word typed has to appear somewhere in a
 * style's name, its other names, or the lines on what it looks like and suits.
 * So "glassmorphism" finds Glass, and "dashboard" finds the styles made for one.
 */
export function searchStyles(styles: CatalogStyle[], query: string): CatalogStyle[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return styles;
  return styles.filter((style) => {
    const text = [style.name, ...style.aka, style.look, style.suits].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * Styles arranged under their families, in the catalog's order. A family with
 * nothing in it is left out; a style whose family the catalog does not list
 * still appears, at the end, rather than vanishing.
 */
export function groupStyles(
  styles: CatalogStyle[],
  groups: StyleGroup[],
): { group: StyleGroup; styles: CatalogStyle[] }[] {
  const known = new Set(groups.map((g) => g.key));
  const sections = groups.map((group) => ({
    group,
    styles: styles.filter((s) => s.group === group.key),
  }));
  const rest = styles.filter((s) => !known.has(s.group));
  if (rest.length > 0) {
    sections.push({ group: { key: "", label: "Other", title: "Other" }, styles: rest });
  }
  return sections.filter((section) => section.styles.length > 0);
}

/** `GET /project/design/styles`: the styles, feel presets and suggested accents. */
export function useDesignCatalog(enabled = true) {
  return useQuery({
    queryKey: designKeys.catalog,
    queryFn: () => api.get<DesignCatalog>("/project/design/styles").then((r) => r.data),
    // The library changes with a deploy, not while a tab is open.
    staleTime: Infinity,
    enabled,
  });
}

/** `GET /project/:id/design`: the app's current look. */
export function useProjectDesign(projectId: string | undefined) {
  return useQuery({
    queryKey: designKeys.project(projectId ?? ""),
    queryFn: () =>
      api.get<ProjectDesignResponse>(`/project/${projectId}/design`).then((r) => r.data),
    enabled: Boolean(projectId),
    retry: false,
    // The agent can change the design too.
    staleTime: 5_000,
  });
}

/**
 * `POST /project/:id/design`: change the app's look.
 *
 * Send only what should change. The API rejects with 409 while tau is
 * building, the same as a theme edit.
 */
export function useRestyle(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DesignConfig) =>
      api.post<RestyleResponse>(`/project/${projectId}/design`, config).then((r) => r.data),
    onSuccess: () => {
      const id = projectId ?? "";
      // The stylesheet, the design file and possibly package.json all moved.
      void qc.invalidateQueries({ queryKey: designKeys.project(id) });
      void qc.invalidateQueries({ queryKey: projectKeys.theme(id) });
      void qc.invalidateQueries({ queryKey: projectKeys.tree(id) });
      for (const path of ["src/index.css", ".tau/DESIGN.md", "index.html", "package.json"]) {
        void qc.invalidateQueries({ queryKey: projectKeys.file(id, path) });
      }
      void qc.invalidateQueries({ queryKey: projectGithubKeys.info(id) });
    },
  });
}

/** How many parts of a design the user has chosen, for a badge on the button that opens the picker. */
export function countChoices(config: DesignConfig): number {
  return [
    config.style,
    config.accent,
    config.mode,
    config.fonts,
    config.dials && Object.keys(config.dials).length > 0 ? config.dials : undefined,
    config.designMd,
  ].filter(Boolean).length;
}

/**
 * The part of a choice that can be kept as a default look: everything but an
 * imported file. Null when nothing is left.
 */
export function withoutImport(
  config: DesignConfig,
): Omit<DesignConfig, "designMd"> | null {
  return compactConfig({ ...config, designMd: undefined });
}

/** Whether two choices are the same look, however their keys are ordered. */
export function sameDesign(a: DesignConfig | null, b: DesignConfig | null): boolean {
  const key = (config: DesignConfig | null) => {
    const c = compactConfig(config ?? {}) ?? {};
    return JSON.stringify([
      c.style,
      c.accent,
      c.mode,
      c.fonts,
      c.dials?.variance,
      c.dials?.motion,
      c.dials?.density,
      c.designMd,
    ]);
  };
  return key(a) === key(b);
}

/** A choice in a few words, for places that show one without the picker. */
export function describeChoice(
  config: DesignConfig,
  catalog: DesignCatalog | undefined,
): string[] {
  const style = catalog?.styles.find((s) => s.key === config.style);
  const parts: string[] = [];
  if (config.style) parts.push(style?.name ?? config.style);
  if (config.mode) parts.push(config.mode === "dark" ? "Dark" : "Light");
  if (config.fonts && config.fonts !== "default") {
    parts.push(style?.fonts.find((f) => f.key === config.fonts)?.label ?? config.fonts);
  }
  if (config.dials && Object.keys(config.dials).length > 0) {
    const preset = (Object.entries(catalog?.feelPresets ?? {}) as [FeelPreset, Dials][]).find(
      ([, dials]) =>
        (["variance", "motion", "density"] as const).every(
          (dial) => config.dials?.[dial] === dials[dial],
        ),
    )?.[0];
    parts.push(preset ? `${preset[0].toUpperCase()}${preset.slice(1)} feel` : "Custom feel");
  }
  return parts;
}

/** A config with empty parts removed, or null when nothing is left to send. */
export function compactConfig(config: DesignConfig): DesignConfig | null {
  const out: DesignConfig = {};
  if (config.style) out.style = config.style;
  if (config.accent) out.accent = config.accent;
  if (config.mode) out.mode = config.mode;
  if (config.fonts && config.style) out.fonts = config.fonts;
  if (config.dials && Object.keys(config.dials).length > 0) out.dials = config.dials;
  if (config.designMd?.trim()) out.designMd = config.designMd.trim();
  return Object.keys(out).length > 0 ? out : null;
}
