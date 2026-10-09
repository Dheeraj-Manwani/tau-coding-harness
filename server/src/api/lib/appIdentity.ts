/**
 * What a published app calls itself: its title, its description and its icon.
 *
 * Pure functions over `index.html`, so the rules are testable without a sandbox
 * and the Publish panel's "Name and logo" step is a mechanical edit that needs
 * no model call (doc/PUBLISHING.md D7). The same shape as `themeSwitchHtml` in
 * `worker/design/apply.ts`: replace a tag that is there, insert one that is
 * not, and never touch the rest of the page.
 */
import { APP_ICON_LINK_TAG } from "@/worker/templates/shared";

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;
/** Each of the two PNGs a custom logo is saved as. */
export const LOGO_MAX_BYTES = 300 * 1024;

export const FAVICON_PATH = "public/favicon.png";
export const ICON_512_PATH = "public/icon-512.png";
export const DEFAULT_ICON_PATH = "public/favicon.svg";

const CUSTOM_ICON_TAG = `<link rel="icon" type="image/png" href="/favicon.png" />`;
const TOUCH_ICON_TAG = `<link rel="apple-touch-icon" href="/icon-512.png" />`;

export type IconKind = "default" | "custom" | "other" | null;

export interface Identity {
  title: string | null;
  description: string | null;
  /** `default` is tau's mark, `custom` an uploaded or generated logo. */
  icon: IconKind;
}

export interface IdentityChange {
  title?: string;
  description?: string;
  /** `default` writes tau's icon link, `custom` the two-PNG logo links. */
  icon?: "default" | "custom";
  /** The site's address with no trailing slash; written into `og:image` for a custom logo. */
  siteUrl?: string;
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** `<meta name|property="key" …>` as one tag, whatever order its attributes are in. */
function metaPattern(key: string): RegExp {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `<meta\\b(?=[^>]*\\b(?:name|property)\\s*=\\s*["']${k}["'])[^>]*>`,
    "i",
  );
}

const ICON_LINK = /<link\b(?=[^>]*\brel\s*=\s*["'](?:shortcut\s+)?icon["'])[^>]*>/gi;
const TOUCH_LINK = /[ \t]*<link\b(?=[^>]*\brel\s*=\s*["']apple-touch-icon["'])[^>]*>[ \t]*\n?/gi;

export function readIdentity(html: string): Identity {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const description = /\bcontent\s*=\s*"([^"]*)"/i.exec(
    metaPattern("description").exec(html)?.[0] ?? "",
  )?.[1];

  const icons = html.match(ICON_LINK) ?? [];
  let icon: IconKind = null;
  if (icons.length > 0) {
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(icons[0]!)?.[1];
    icon =
      href === "/favicon.svg"
        ? "default"
        : href === "/favicon.png"
          ? "custom"
          : "other";
  }

  return {
    title: title ? unescapeAttr(title) : null,
    description: description ? unescapeAttr(description) : null,
    icon,
  };
}

function setMeta(html: string, key: string, content: string, attr: "name" | "property"): string {
  const tag = `<meta ${attr}="${key}" content="${escapeAttr(content)}" />`;
  const pattern = metaPattern(key);
  return pattern.test(html)
    ? html.replace(pattern, () => tag)
    : html.replace(/<\/head>/i, () => `  ${tag}\n  </head>`);
}

function dropMeta(html: string, key: string): string {
  return html.replace(
    new RegExp(`[ \\t]*${metaPattern(key).source}[ \\t]*\\n?`, "i"),
    "",
  );
}

/**
 * `index.html` with the owner's name, description and icon in it.
 *
 * Idempotent, escapes whatever was typed, and returns the input unchanged when
 * there is no `</head>` to put anything in. The Open Graph and Twitter tags
 * follow the title and description, so a shared link says what the tab says.
 * `og:image` is written only for a custom logo and only when the site's
 * address is known, because it has to be an absolute URL.
 */
export function applyIdentity(html: string, change: IdentityChange): string {
  if (!/<\/head>/i.test(html)) return html;
  let out = html;

  if (change.title !== undefined) {
    const title = `<title>${escapeAttr(change.title)}</title>`;
    out = /<title[^>]*>[\s\S]*?<\/title>/i.test(out)
      ? out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => title)
      : out.replace(/<\/head>/i, () => `  ${title}\n  </head>`);
  }
  if (change.description !== undefined) {
    out = setMeta(out, "description", change.description, "name");
  }

  // Social tags describe whatever the page now says, including parts the owner
  // did not touch this time.
  const now = readIdentity(out);
  if (change.title !== undefined && now.title) {
    out = setMeta(out, "og:title", now.title, "property");
  }
  if (change.description !== undefined && now.description) {
    out = setMeta(out, "og:description", now.description, "property");
  }
  if (change.title !== undefined || change.description !== undefined) {
    out = setMeta(out, "og:type", "website", "property");
    out = setMeta(out, "twitter:card", "summary", "name");
  }

  if (change.icon === "default") {
    out = withIconTags(out, [APP_ICON_LINK_TAG]);
    out = dropMeta(out, "og:image");
  } else if (change.icon === "custom") {
    out = withIconTags(out, [CUSTOM_ICON_TAG, TOUCH_ICON_TAG]);
    out = change.siteUrl
      ? setMeta(out, "og:image", `${change.siteUrl.replace(/\/+$/, "")}/icon-512.png`, "property")
      : dropMeta(out, "og:image");
  }

  return out;
}

/** Every icon link replaced, in place, by `tags`; inserted if the page had none. */
function withIconTags(html: string, tags: string[]): string {
  const stripped = html.replace(TOUCH_LINK, "");
  const joined = tags.join("\n  ");
  let placed = false;
  const replaced = stripped.replace(ICON_LINK, () => {
    if (placed) return "";
    placed = true;
    return joined;
  });
  return placed
    ? replaced
    : replaced.replace(/<\/head>/i, () => `  ${joined}\n  </head>`);
}

// ── Logo files ───────────────────────────────────────────────────────────────

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whether these bytes are a PNG: the signature is checked, not the name or type claimed. */
export function isPng(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/** Why a logo file cannot be used, or null when it can. */
export function logoFileProblem(bytes: Uint8Array, label: string): string | null {
  if (bytes.byteLength === 0) return `The ${label} is empty.`;
  if (bytes.byteLength > LOGO_MAX_BYTES) {
    return `The ${label} is over ${LOGO_MAX_BYTES / 1024} KB. Use a simpler picture.`;
  }
  if (!isPng(bytes)) return `The ${label} is not a PNG.`;
  return null;
}
