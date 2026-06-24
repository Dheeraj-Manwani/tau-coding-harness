import { useEffect, useMemo, useRef, useState } from "react";
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

// Register the common web languages the agent emits (keeps the bundle small).
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

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function languageFor(name: string): string {
  if (name.endsWith(".tsx")) return "tsx";
  if (name.endsWith(".ts")) return "typescript";
  if (name.endsWith(".jsx")) return "jsx";
  if (name.endsWith(".js") || name.endsWith(".mjs")) return "javascript";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".css")) return "css";
  if (name.endsWith(".html") || name.endsWith(".svg")) return "markup";
  return "text";
}

// ── Dynamic file tree ───────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children: TreeNode[];
}

/** Turn a flat list of file paths into a nested folder/file tree. */
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isFile: false, children: [] };

  for (const fullPath of paths) {
    const parts = fullPath.split("/").filter(Boolean);
    let node = root;
    let acc = "";
    parts.forEach((segment, i) => {
      acc = acc ? `${acc}/${segment}` : segment;
      const isFile = i === parts.length - 1;
      let child = node.children.find(
        (c) => c.name === segment && c.isFile === isFile,
      );
      if (!child) {
        child = { name: segment, path: acc, isFile, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }

  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) =>
      a.isFile !== b.isFile
        ? a.isFile
          ? 1
          : -1
        : a.name.localeCompare(b.name),
    );
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root.children;
}

function folderPaths(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) =>
    n.isFile ? [] : [n.path, ...folderPaths(n.children)],
  );
}

function renderNodes(
  nodes: TreeNode[],
  activeFileId: string,
  openFile: (id: string) => void,
): React.ReactNode {
  return nodes.map((node) =>
    node.isFile ? (
      <File
        key={node.path}
        value={node.path}
        handleSelect={openFile}
        isSelect={activeFileId === node.path}
        fileIcon={<MaterialIcon name={node.name} className="size-4" />}
      >
        <span>{node.name}</span>
      </File>
    ) : (
      <Folder key={node.path} value={node.path} element={node.name}>
        {renderNodes(node.children, activeFileId, openFile)}
      </Folder>
    ),
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function TabBar() {
  const files = useProjectStore((s) => s.files);
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
          if (!files[id]) return null;
          const name = basename(id);
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
                  <MaterialIcon name={name} className="size-3.5" />
                  <span className="whitespace-nowrap">{name}</span>
                  <button
                    type="button"
                    aria-label={`Close ${name}`}
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
  const files = useProjectStore((s) => s.files);
  const activeFileId = useProjectStore((s) => s.activeFileId);
  const file = activeFileId ? files[activeFileId] : undefined;

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--space-void)] text-sm text-[var(--silver-600)]">
        Select a file to view its contents
      </div>
    );
  }

  const name = basename(file.path);

  return (
    <div className="flex h-full flex-col bg-[var(--space-void)]">
      <TabBar />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <SyntaxHighlighter
          language={languageFor(name)}
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
  const files = useProjectStore((s) => s.files);
  const codeTreeWidth = useProjectStore((s) => s.codeTreeWidth);
  const setCodeTreeWidth = useProjectStore((s) => s.setCodeTreeWidth);
  const activeFileId = useProjectStore((s) => s.activeFileId);
  const openFile = useProjectStore((s) => s.openFile);

  const containerRef = useRef<HTMLDivElement>(null);

  const paths = useMemo(() => Object.keys(files), [files]);
  const tree = useMemo(() => buildTree(paths), [paths]);
  const expanded = useMemo(() => folderPaths(tree), [tree]);
  // Re-mount the Tree (re-applying expanded folders) only when the folder
  // structure changes — not on every file content chunk.
  const treeKey = expanded.join("|");

  const handleDrag = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    const width = el.clientWidth;
    const next = Math.min(Math.max(clientX - left, 160), width - 300);
    setCodeTreeWidth(next);
  };

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      <div
        style={{ width: codeTreeWidth }}
        className="shrink-0 overflow-hidden bg-[var(--space-surface)] py-2 text-[var(--silver-900)]"
      >
        {paths.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--silver-600)]">
            Files will appear here as tau builds your app.
          </div>
        ) : (
          <Tree
            key={treeKey}
            className="scrollbar-thin"
            initialSelectedId={activeFileId}
            initialExpandedItems={expanded}
          >
            {renderNodes(tree, activeFileId, openFile)}
          </Tree>
        )}
      </div>

      <ResizeHandle onDrag={handleDrag} />

      <div className="min-w-0 flex-1">
        <CodeEditor />
      </div>
    </div>
  );
}
