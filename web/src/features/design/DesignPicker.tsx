import { useRef, useState, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  FileUpIcon,
  MoonIcon,
  SearchIcon,
  SparklesIcon,
  SunIcon,
  XIcon,
} from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import {
  groupStyles,
  searchStyles,
  stylePreviewUrl,
  type CatalogStyle,
  type DesignCatalog,
  type DesignConfig,
  type DesignSummary,
  type Dials,
  type FeelPreset,
} from "@/src/features/design/api";

/** Mirrors `MAX_IMPORTED_DESIGN_CHARS` on the server, which refuses anything longer. */
const MAX_DESIGN_FILE_CHARS = 40_000;

const DIALS: { key: keyof Dials; label: string; low: string; high: string }[] = [
  { key: "variance", label: "Layout", low: "Predictable", high: "Surprising" },
  { key: "motion", label: "Motion", low: "Still", high: "Lively" },
  { key: "density", label: "Density", low: "Airy", high: "Packed" },
];

const FEELS: { key: FeelPreset; label: string }[] = [
  { key: "calm", label: "Calm" },
  { key: "balanced", label: "Balanced" },
  { key: "bold", label: "Bold" },
];

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-silver-900">
          {title}
        </h3>
        {hint && <span className="text-[11px] text-silver-600">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** A small rounded choice; the selected one is filled the way the effort toggle's is. */
function Chip({
  selected,
  onClick,
  children,
  title,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-xs font-medium transition-colors",
        selected
          ? "border-blue-500/50 bg-blue-500/20 text-blue-300"
          : "border-silver-400/30 text-silver-600 hover:bg-space-overlay hover:text-silver-900",
      )}
    >
      {children}
    </button>
  );
}

function StyleCard({
  style,
  selected,
  onSelect,
}: {
  style: CatalogStyle;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      title={`${style.look} Suits: ${style.suits}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors",
        selected
          ? "border-blue-500 ring-2 ring-blue-500/30"
          : "border-silver-400/30 hover:border-silver-600/60",
      )}
    >
      {/* The background is the style's own page colour, so a thumbnail that is
          still loading (or missing) is at least the right colour. */}
      <div
        className="aspect-[8/5] w-full overflow-hidden"
        style={{ backgroundColor: style.swatch.background }}
      >
        <img
          src={stylePreviewUrl(style.key)}
          alt=""
          loading="lazy"
          className="size-full object-cover object-left-top"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      </div>
      <div className="flex flex-1 items-start justify-between gap-2 border-t border-silver-400/20 px-2.5 py-1.5">
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-silver-900">
            {style.name}
          </span>
          {/* The name people may know it by, where tau's is different. */}
          {style.aka?.[0] && (
            <span className="block truncate text-[10px] text-silver-600">
              {style.aka[0]}
            </span>
          )}
        </span>
        <span
          className="mt-0.5 size-3 shrink-0 rounded-full border border-black/10"
          style={{ backgroundColor: style.swatch.primary }}
        />
      </div>
      {selected && (
        <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-blue-500 text-white">
          <CheckIcon className="size-3" />
        </span>
      )}
    </button>
  );
}

/** Which preset the chosen dials are, if they are exactly one. */
function presetOf(
  dials: Partial<Dials> | undefined,
  presets: DesignCatalog["feelPresets"],
): FeelPreset | null {
  if (!dials) return null;
  return (
    FEELS.find(({ key }) =>
      DIALS.every((d) => dials[d.key] === presets[key][d.key]),
    )?.key ?? null
  );
}

interface DesignPickerProps {
  catalog: DesignCatalog;
  value: DesignConfig;
  onChange: (next: DesignConfig) => void;
  /**
   * The app's current design, when restyling one. Changes what "nothing
   * chosen" means: for a new app it is "tau decides", for an existing one it
   * is "keep what it has".
   */
  current?: DesignSummary | null;
  /**
   * Whether a DESIGN.md can be brought. False where the choice outlives the
   * project — a default look — because a design file is written for one app.
   */
  allowImport?: boolean;
}

/**
 * The controls for choosing a look: a style, an accent, light or dark, a font
 * pairing, the feel, or a DESIGN.md of the user's own.
 *
 * Everything is optional and nothing is preselected. That matters more than it
 * looks: a picker that opened on "Editorial" would have most people building
 * Editorial apps without having chosen to, and the point of tau deciding is
 * that the look fits what is being built.
 */
export function DesignPicker({
  catalog,
  value,
  onChange,
  current,
  allowImport = true,
}: DesignPickerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fineTune, setFineTune] = useState(false);
  const [importOpen, setImportOpen] = useState(Boolean(value.designMd));
  /** The family the gallery is narrowed to, or null for all of them. */
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const restyling = current != null;
  const unset = restyling ? "Keep" : "Auto";
  const set = (patch: Partial<DesignConfig>) => onChange({ ...value, ...patch });

  // The style whose font pairings and defaults apply: the one picked, else the
  // one the app already has.
  const styleKey = value.style ?? current?.style;
  const style = catalog.styles.find((s) => s.key === styleKey);

  // The gallery: narrowed to one family or to a search, and shown in families
  // either way, since twenty-odd cards in one grid cannot be scanned. A catalog
  // from a server that predates families is one unnamed section.
  const groups = catalog.groups ?? [];
  const shown = searchStyles(
    group ? catalog.styles.filter((s) => s.group === group) : catalog.styles,
    query,
  );
  const sections = groupStyles(shown, groups);

  const preset = presetOf(value.dials, catalog.feelPresets);
  // What the sliders show for a dial nobody has set: where it will land.
  const baseDials: Dials =
    (value.style ? style?.dials : (current?.dials ?? style?.dials)) ??
    catalog.feelPresets.balanced;

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    if (text.includes("\0")) {
      toast.error("That doesn't look like a text file.");
      return;
    }
    if (text.length > MAX_DESIGN_FILE_CHARS) {
      toast.error("That design file is too long to import.");
      return;
    }
    set({ designMd: text });
    setImportOpen(true);
  };

  return (
    <div className="space-y-5">
      <Section
        title="Style"
        hint={
          value.style
            ? style?.look
            : restyling
              ? `Currently ${current.styleName}`
              : "tau picks one that suits what you describe"
        }
      >
        <button
          type="button"
          aria-pressed={!value.style}
          onClick={() => set({ style: undefined, fonts: undefined })}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left transition-colors",
            !value.style
              ? "border-blue-500 bg-blue-500/10 text-blue-300"
              : "border-silver-400/40 text-silver-600 hover:border-silver-600/60 hover:text-silver-900",
          )}
        >
          <SparklesIcon className="size-4 shrink-0" />
          <span className="text-xs font-semibold">
            {restyling ? `Keep ${current.styleName}` : "Let tau decide"}
          </span>
          {!value.style && <CheckIcon className="ml-auto size-3.5 shrink-0" />}
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip selected={group === null} onClick={() => setGroup(null)}>
            All
          </Chip>
          {groups.map((g) => (
            <Chip
              key={g.key}
              selected={group === g.key}
              onClick={() => setGroup(group === g.key ? null : g.key)}
              title={g.title}
            >
              {g.label}
            </Chip>
          ))}
          <label className="relative ml-auto w-full sm:w-44">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-silver-600" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search styles"
              aria-label="Search styles"
              className="w-full rounded-[7px] border border-silver-400/30 bg-transparent py-1 pr-2 pl-6 text-xs text-silver-900 outline-none placeholder:text-silver-600/70 focus-visible:border-blue-500/60"
            />
          </label>
        </div>

        {sections.length === 0 ? (
          <p className="rounded-lg border border-silver-400/20 px-3 py-6 text-center text-xs text-silver-600">
            No style matches “{query.trim()}”.
          </p>
        ) : (
          <div className="space-y-3">
            {sections.map((section) => (
              <div key={section.group.key} className="space-y-1.5">
                {/* One family on show needs no heading; the chip already names it. */}
                {sections.length > 1 && (
                  <h4 className="text-[11px] font-medium text-silver-600">
                    {section.group.title}
                  </h4>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {section.styles.map((s) => (
                    <StyleCard
                      key={s.key}
                      style={s}
                      selected={value.style === s.key}
                      // A pairing belongs to its style, so it does not follow a change of style.
                      onSelect={() => set({ style: s.key, fonts: undefined })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Accent colour" hint={value.accent ?? (restyling ? current.accent : undefined)}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip selected={!value.accent} onClick={() => set({ accent: undefined })}>
            {unset}
          </Chip>
          {catalog.suggestedAccents.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={`Accent ${hex}`}
              aria-pressed={value.accent === hex}
              onClick={() => set({ accent: hex })}
              className={cn(
                "size-6 rounded-full border transition-transform hover:scale-110",
                value.accent === hex
                  ? "border-white ring-2 ring-blue-500"
                  : "border-black/20",
              )}
              style={{ backgroundColor: hex }}
            />
          ))}
          {/* The native picker: it only ever emits #rrggbb, which is the one
              form the server accepts. */}
          <label
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-[7px] border px-2 py-1 text-xs font-medium transition-colors",
              value.accent && !catalog.suggestedAccents.includes(value.accent)
                ? "border-blue-500/50 bg-blue-500/20 text-blue-300"
                : "border-silver-400/30 text-silver-600 hover:bg-space-overlay hover:text-silver-900",
            )}
          >
            <input
              type="color"
              value={value.accent ?? current?.accent ?? "#4d7c0f"}
              onChange={(e) => set({ accent: e.target.value.toLowerCase() })}
              aria-label="Pick a custom accent colour"
              className="size-4 cursor-pointer rounded-sm border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-0"
            />
            Custom
          </label>
        </div>
      </Section>

      <div className="grid gap-5 sm:grid-cols-2">
        <Section title="Light or dark">
          <div className="flex flex-wrap gap-1.5">
            <Chip selected={!value.mode} onClick={() => set({ mode: undefined })}>
              {unset}
            </Chip>
            <Chip selected={value.mode === "light"} onClick={() => set({ mode: "light" })}>
              <SunIcon className="size-3" /> Light
            </Chip>
            <Chip selected={value.mode === "dark"} onClick={() => set({ mode: "dark" })}>
              <MoonIcon className="size-3" /> Dark
            </Chip>
          </div>
        </Section>

        <Section title="Feel">
          <div className="flex flex-wrap gap-1.5">
            <Chip selected={!value.dials} onClick={() => set({ dials: undefined })}>
              {unset}
            </Chip>
            {FEELS.map(({ key, label }) => (
              <Chip
                key={key}
                selected={preset === key}
                onClick={() => set({ dials: { ...catalog.feelPresets[key] } })}
              >
                {label}
              </Chip>
            ))}
            <Chip
              selected={fineTune || (Boolean(value.dials) && preset === null)}
              onClick={() => setFineTune((open) => !open)}
            >
              Fine-tune
              <ChevronDownIcon className={cn("size-3 transition-transform", fineTune && "rotate-180")} />
            </Chip>
          </div>
        </Section>
      </div>

      {fineTune && (
        <div className="grid gap-3 rounded-lg border border-silver-400/20 bg-space-overlay/40 p-3 sm:grid-cols-3">
          {DIALS.map((d) => {
            const chosen = value.dials?.[d.key];
            return (
              <label key={d.key} className="space-y-1">
                <span className="flex items-baseline justify-between text-[11px]">
                  <span className="font-semibold text-silver-900">{d.label}</span>
                  <span className={chosen ? "text-blue-300" : "text-silver-600"}>
                    {chosen ?? `${unset.toLowerCase()} (${baseDials[d.key]})`}
                  </span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={chosen ?? baseDials[d.key]}
                  onChange={(e) =>
                    set({ dials: { ...value.dials, [d.key]: Number(e.target.value) } })
                  }
                  className="w-full accent-blue-500"
                />
                <span className="flex justify-between text-[10px] text-silver-600">
                  <span>{d.low}</span>
                  <span>{d.high}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      <Section
        title="Typefaces"
        hint={style ? undefined : "Choose a style to choose its typefaces"}
      >
        {style ? (
          <div className="flex flex-wrap gap-1.5">
            {style.fonts.map((pairing, i) => {
              // With no pairing chosen, a new style gets its own; an existing
              // app keeps whichever it has.
              const kept = !value.style && current ? current.fonts : "default";
              const selected = value.fonts ? value.fonts === pairing.key : pairing.key === kept;
              return (
                <Chip
                  key={pairing.key}
                  selected={selected}
                  onClick={() =>
                    // A pairing is stored against a style, so choosing one
                    // settles the style too.
                    set({ style: style.key, fonts: pairing.key })
                  }
                  title={i === 0 ? "This style's own pairing" : undefined}
                >
                  {pairing.label}
                </Chip>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-silver-600">
            Each style comes with a pairing of its own and two alternatives.
          </p>
        )}
      </Section>

      {allowImport && (
      <section className="rounded-lg border border-silver-400/20">
        <button
          type="button"
          onClick={() => setImportOpen((open) => !open)}
          aria-expanded={importOpen}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        >
          <span className="text-xs font-semibold text-silver-900">
            Bring your own DESIGN.md
            {value.designMd && (
              <span className="ml-2 font-normal text-blue-300">
                {value.designMd.length.toLocaleString()} characters
              </span>
            )}
          </span>
          <ChevronDownIcon
            className={cn("size-3.5 text-silver-600 transition-transform", importOpen && "rotate-180")}
          />
        </button>
        {importOpen && (
          <div className="space-y-2 border-t border-silver-400/20 p-3">
            <p className="text-[11px] leading-relaxed text-silver-600">
              Paste or upload a design file. tau uses its colours, typefaces and
              corner radius where it gives them, and follows what it says
              everywhere else. Anything you choose above still wins.
            </p>
            <textarea
              value={value.designMd ?? ""}
              onChange={(e) =>
                set({ designMd: e.target.value.slice(0, MAX_DESIGN_FILE_CHARS) || undefined })
              }
              rows={5}
              spellCheck={false}
              placeholder={"---\ncolors:\n  primary: \"#0b5fff\"\n---\n# My design\n…"}
              className="scrollbar-thin w-full resize-y rounded-md border border-silver-400/30 bg-space-surface p-2 font-mono text-[11px] text-silver-900 outline-none placeholder:text-silver-600/60 focus-visible:border-blue-500/60"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex items-center gap-1.5 rounded-[7px] border border-silver-400/30 px-2.5 py-1 text-xs font-medium text-silver-600 transition-colors hover:bg-space-overlay hover:text-silver-900"
              >
                <FileUpIcon className="size-3" /> Upload a file
              </button>
              {value.designMd && (
                <button
                  type="button"
                  onClick={() => set({ designMd: undefined })}
                  className="flex items-center gap-1 rounded-[7px] px-2 py-1 text-xs font-medium text-silver-600 transition-colors hover:bg-space-overlay hover:text-silver-900"
                >
                  <XIcon className="size-3" /> Remove
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                hidden
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                onChange={(e) => {
                  void readFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        )}
      </section>
      )}
    </div>
  );
}
