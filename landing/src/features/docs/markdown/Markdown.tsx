import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { Link } from "react-router-dom";
import { ExternalLinkIcon, LinkIcon } from "lucide-react";

import { Callout } from "./Callout";
import { calloutKindOf, type CalloutKind } from "./calloutKind";
import { CodeBlock } from "./CodeBlock";
import { APP_SIGNUP } from "@/src/lib/routes";

/**
 * The docs renderer.
 *
 * Deliberately not `ChatMarkdown`: that one is tuned for chat bubbles: tight
 * spacing, no headings worth linking to, no tables to speak of. A reference
 * page needs anchored headings, wide scrollable tables and real code blocks.
 * The two share nothing but the underlying library, and keeping them apart
 * means neither is constrained by the other's layout.
 *
 * `rehype-slug` puts stable ids on headings, which is what makes both the
 * right-rail contents and every deep link into a doc work.
 */

/** Flattens a node tree back to text, for markers and heading anchors. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

/**
 * Strips the `[!NOTE]` marker from the first text run inside a callout.
 *
 * The marker arrives as the opening characters of the first paragraph's first
 * child, so this has to reach one level into the tree. `cloneElement` rather
 * than spreading the element: a spread produces a plain object that is no
 * longer a valid React element, which is why the marker survived the first
 * attempt at this and rendered as literal text.
 */
function withoutMarker(children: ReactNode, kind: CalloutKind): ReactNode {
  const marker = new RegExp(`^\\s*\\[!${kind}\\]\\s*`, "i");
  let stripped = false;

  const strip = (node: ReactNode): ReactNode => {
    if (stripped) return node;
    if (typeof node === "string") {
      // Markdown leaves whitespace-only text nodes between block children.
      // Spending the one strip on a newline is why this looked like it worked
      // and didn't: the marker sits in the *next* string along.
      if (node.trim() === "") return node;
      stripped = true;
      return node.replace(marker, "");
    }
    if (isValidElement<{ children?: ReactNode }>(node)) {
      const inner = Children.toArray(node.props.children).map(strip);
      return cloneElement(node, node.props, ...inner);
    }
    return node;
  };

  return Children.toArray(children).map(strip);
}

function Heading({
  level,
  id,
  children,
}: {
  level: 2 | 3;
  id?: string;
  children: ReactNode;
}) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag
      id={id}
      className={
        level === 2
          ? "group scroll-mt-24 pt-10 text-xl font-semibold text-silver-900"
          : "group scroll-mt-24 pt-6 text-base font-semibold text-silver-900"
      }
    >
      {children}
      {id && (
        <a
          href={`#${id}`}
          aria-label={`Link to ${textOf(children)}`}
          className="ml-2 inline-block align-middle text-silver-400 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <LinkIcon className="size-3.5" />
        </a>
      )}
    </Tag>
  );
}

const COMPONENTS: Components = {
  h1: ({ children }) => (
    // The page's own <h1> comes from frontmatter, so a markdown h1 would be a
    // second one. Demote rather than drop it.
    <h2 className="pt-10 text-xl font-semibold text-silver-900">{children}</h2>
  ),
  h2: ({ id, children }) => (
    <Heading level={2} id={id}>
      {children}
    </Heading>
  ),
  h3: ({ id, children }) => (
    <Heading level={3} id={id}>
      {children}
    </Heading>
  ),
  p: ({ children }) => (
    <p className="mt-4 leading-7 text-silver-600">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mt-4 list-disc space-y-2 pl-5 text-silver-600 marker:text-silver-400">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-4 list-decimal space-y-2 pl-5 text-silver-600 marker:text-silver-400">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-7">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-silver-900">{children}</strong>
  ),
  hr: () => <hr className="my-10 border-silver-200" />,

  blockquote: ({ children }) => {
    const kind = calloutKindOf(textOf(children));
    if (kind) return <Callout kind={kind}>{withoutMarker(children, kind)}</Callout>;
    return (
      <blockquote className="my-6 border-l-2 border-silver-400 pl-4 text-silver-600 italic">
        {children}
      </blockquote>
    );
  },

  // Several reference tables are wider than the column. Scrolling the table,
  // rather than the page, is mandatory (§7).
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-xl border border-silver-200">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-silver-200 bg-space-surface">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium text-silver-900">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-t border-silver-200/60 px-4 py-2.5 align-top text-silver-600">
      {children}
    </td>
  ),

  a: ({ href, children }) => {
    const target = href === "/signup" ? APP_SIGNUP : (href ?? "");
    const external = /^https?:\/\//.test(target);
    if (external) {
      return (
        <a
          href={target}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-0.5 text-blue-500 hover:underline"
        >
          {children}
          <ExternalLinkIcon className="size-3" aria-hidden="true" />
        </a>
      );
    }
    if (target.startsWith("#")) {
      return (
        <a href={target} className="text-blue-500 hover:underline">
          {children}
        </a>
      );
    }
    // Internal links go through the router, so moving between docs pages never
    // costs a full page load.
    return (
      <Link to={target} className="text-blue-500 hover:underline">
        {children}
      </Link>
    );
  },

  code: ({ className, children, ...props }) => {
    const language = /language-(\w+)/.exec(className ?? "")?.[1];
    const isBlock = "data-block" in props || Boolean(language);
    if (!isBlock) {
      return (
        <code className="rounded bg-space-surface px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300">
          {children}
        </code>
      );
    }
    return <CodeBlock code={String(children).replace(/\n$/, "")} language={language} />;
  },
  // react-markdown wraps fenced code in <pre><code>; CodeBlock brings its own
  // frame, so the wrapper would double the border and padding.
  pre: ({ children }) => <>{children}</>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="docs-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default Markdown;
