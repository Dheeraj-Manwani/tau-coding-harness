import { useEffect, useRef, useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { okaidia } from "react-syntax-highlighter/dist/esm/styles/prism";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import { getIcon } from "material-file-icons";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsRightIcon,
  XIcon,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/src/components/ui/context-menu";

// Register only the languages used by the mock files (keeps the bundle small).
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("markup", markup);

import { cn } from "@/src/lib/utils";
import { File, Folder, Tree } from "@/src/components/ui/file-tree";
import { useProjectStore } from "@/src/stores/useProjectStore";
import { MOCK_FILES } from "@/src/features/project/mockFiles";
import { ResizeHandle } from "@/src/features/project/ResizeHandle";

/** Material (VS Code) file icon for a filename, sized to fit inline. */
function MaterialIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const icon = getIcon(name);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}

function languageFor(name: string): string {
  if (name.endsWith(".tsx")) return "tsx";
  if (name.endsWith(".ts")) return "typescript";
  if (name.endsWith(".jsx")) return "jsx";
  if (name.endsWith(".js")) return "javascript";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".css")) return "css";
  if (name.endsWith(".html")) return "markup";
  return "text";
}

function TabBar() {
  const openFiles = useProjectStore((s) => s.openFiles);
  const activeFileId = useProjectStore((s) => s.activeFileId);
  const setActiveFile = useProjectStore((s) => s.setActiveFile);
  const closeFile = useProjectStore((s) => s.closeFile);
  const closeFilesToRight = useProjectStore((s) => s.closeFilesToRight);
  const closeAllFiles = useProjectStore((s) => s.closeAllFiles);

  const stripRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  // Track whether the tab strip overflows in either direction so the nav arrows
  // can show/hide. Re-evaluates on scroll, on tab changes, and on resize.
  const refresh = () => {
    const el = stripRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 0);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    refresh();
    const ro = new ResizeObserver(refresh);
    ro.observe(el);
    return () => ro.disconnect();
  }, [openFiles]);

  const scrollByTabs = (dir: -1 | 1) =>
    stripRef.current?.scrollBy({ left: dir * 160, behavior: "smooth" });

  const arrowClass =
    "flex shrink-0 items-center justify-center px-1 text-[var(--silver-600)] transition-colors hover:text-[var(--silver-900)]";

  return (
    <div className="flex shrink-0 items-stretch border-b border-[var(--silver-200)] bg-[var(--space-surface)]">
      {canLeft && (
        <button
          type="button"
          aria-label="Scroll tabs left"
          onClick={() => scrollByTabs(-1)}
          className={arrowClass}
        >
          <ChevronLeftIcon className="size-4" />
        </button>
      )}

      <div
        ref={stripRef}
        onScroll={refresh}
        // Translate vertical wheel into horizontal scroll so many tabs are reachable.
        onWheel={(e) => {
          if (stripRef.current && e.deltaY !== 0) {
            stripRef.current.scrollLeft += e.deltaY;
          }
        }}
        className="scrollbar-none flex min-w-0 flex-1 items-end gap-px overflow-x-auto px-1 pt-1"
      >
        {openFiles.map((id, index) => {
          const file = MOCK_FILES[id];
          if (!file) return null;
          const isActive = id === activeFileId;
          const isLast = index === openFiles.length - 1;
          return (
            <ContextMenu key={id}>
              <ContextMenuTrigger asChild>
                <div
                  onClick={() => setActiveFile(id)}
                  className={cn(
                    "group/tab flex shrink-0 cursor-pointer items-center gap-2 border px-3 py-1.5 text-xs",
                    isActive
                      ? "border-[var(--silver-200)] bg-[var(--space-overlay)] text-[var(--silver-900)]"
                      : "border-transparent text-[var(--silver-600)] hover:text-[var(--silver-900)]",
                  )}
                  style={{
                    borderTopLeftRadius: "var(--radius)",
                    borderTopRightRadius: "var(--radius)",
                  }}
                >
                  <MaterialIcon name={file.name} className="size-3.5" />
                  <span className="whitespace-nowrap">{file.name}</span>
                  <button
                    type="button"
                    aria-label={`Close ${file.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFile(id);
                    }}
                    className="flex size-4 items-center justify-center rounded-[var(--radius-sm)] opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-[var(--space-void)]"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => closeFile(id)}>
                  <XIcon />
                  Close
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={isLast}
                  onSelect={() => closeFilesToRight(id)}
                >
                  <ChevronsRightIcon />
                  Close tabs to the right
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => closeAllFiles()}
                >
                  <XIcon />
                  Close all tabs
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>

      {canRight && (
        <button
          type="button"
          aria-label="Scroll tabs right"
          onClick={() => scrollByTabs(1)}
          className={arrowClass}
        >
          <ChevronRightIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

function CodeEditor() {
  const activeFileId = useProjectStore((s) => s.activeFileId);
  const file = activeFileId ? MOCK_FILES[activeFileId] : undefined;

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--space-void)] text-sm text-[var(--silver-600)]">
        Select a file to view its contents
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--space-void)]">
      <TabBar />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <SyntaxHighlighter
          language={languageFor(file.name)}
          style={okaidia}
          showLineNumbers
          lineNumberStyle={{
            minWidth: "2.5em",
            paddingRight: "1em",
            opacity: 0.5,
            userSelect: "none",
          }}
          customStyle={{
            margin: 0,
            padding: "0.75rem 0",
            fontSize: "13px",
            minHeight: "100%",
          }}
          codeTagProps={{
            // Override the global `code {}` base styles (which force
            // inline-flex + padding/bg) so the editor renders as a block.
            style: {
              fontFamily: "var(--mono)",
              display: "block",
              background: "transparent",
              padding: 0,
              borderRadius: 0,
              whiteSpace: "pre",
            },
          }}
        >
          {file.content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

export function CodePane() {
  const codeTreeWidth = useProjectStore((s) => s.codeTreeWidth);
  const setCodeTreeWidth = useProjectStore((s) => s.setCodeTreeWidth);
  const activeFileId = useProjectStore((s) => s.activeFileId);
  const openFile = useProjectStore((s) => s.openFile);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleDrag = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    const width = el.clientWidth;
    const next = Math.min(Math.max(clientX - left, 160), width - 300);
    setCodeTreeWidth(next);
  };

  const treeFile = (id: string, label: string) => (
    <File
      value={id}
      handleSelect={openFile}
      isSelect={activeFileId === id}
      fileIcon={<MaterialIcon name={label} className="size-4" />}
    >
      <span>{label}</span>
    </File>
  );

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      <div
        style={{ width: codeTreeWidth }}
        className="shrink-0 overflow-hidden bg-[var(--space-surface)] py-2 text-[var(--silver-900)]"
      >
        <Tree
          className="scrollbar-thin"
          initialSelectedId={activeFileId}
          initialExpandedItems={["src", "components", "pages"]}
        >
          <Folder element="src" value="src">
            <Folder element="components" value="components">
              {treeFile("hero", "Hero.tsx")}
              {treeFile("features", "Features.tsx")}
              {treeFile("pricing", "Pricing.tsx")}
            </Folder>
            <Folder element="pages" value="pages">
              {treeFile("homePage", "Home.tsx")}
            </Folder>
            {treeFile("app", "App.tsx")}
            {treeFile("main", "main.tsx")}
            {treeFile("indexCss", "index.css")}
          </Folder>
          <Folder element="public" value="public">
            {treeFile("indexHtml", "index.html")}
          </Folder>
          {treeFile("pkg", "package.json")}
          {treeFile("viteConfig", "vite.config.ts")}
          {treeFile("tsconfig", "tsconfig.json")}
        </Tree>
      </div>

      <ResizeHandle onDrag={handleDrag} />

      <div className="min-w-0 flex-1">
        <CodeEditor />
      </div>
    </div>
  );
}
