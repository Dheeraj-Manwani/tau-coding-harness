import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { EditorView, keymap } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { css as cssLang } from "@codemirror/lang-css";
import { json as jsonLang } from "@codemirror/lang-json";
import { html as htmlLang } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";
import { getIcon } from "material-file-icons";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsRightIcon,
  LoaderCircleIcon,
  XIcon,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/src/components/ui/context-menu";

import { cn } from "@/src/lib/utils";
import { File, Folder, Tree } from "@/src/components/ui/file-tree";
import {
  isFileDirty,
  useProjectStore,
  type ProjectFile as ProjectFileState,
} from "@/src/stores/useProjectStore";
import { useProjectFile } from "@/src/features/project/api";
import { useFileSave } from "@/src/features/project/useFileSave";
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

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

// Binary asset extensions: mirrors the server's isBinaryPath. These are served
// as a presigned URL (not text) and rendered as a preview, never in CodeMirror.
// SVG is intentionally absent: it's XML text and stays editable in the editor.
const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "tiff", "tif",
  "woff", "woff2", "ttf", "otf", "eot", "mp3", "wav", "ogg", "mp4", "webm",
  "mov", "pdf",
]);
const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico",
]);

function isBinaryPath(path: string): boolean {
  return BINARY_EXTS.has(extOf(path));
}

/**
 * CodeMirror language extensions for the file types the agent emits.
 *
 * Note these are *syntax* modes only: there is deliberately no TypeScript
 * language service here. Type definitions live in the sandbox's node_modules,
 * which is excluded from the file manifest (`seedTemplateFiles`), so semantic
 * analysis in the browser would flag every third-party import as unresolved.
 * See doc/USER_CODE_EDITING.md §3.
 */
function languageFor(name: string) {
  if (name.endsWith(".tsx")) return [javascript({ typescript: true, jsx: true })];
  if (name.endsWith(".ts")) return [javascript({ typescript: true })];
  if (name.endsWith(".jsx")) return [javascript({ jsx: true })];
  if (name.endsWith(".js") || name.endsWith(".mjs")) return [javascript()];
  if (name.endsWith(".json")) return [jsonLang()];
  if (name.endsWith(".css")) return [cssLang()];
  if (name.endsWith(".html") || name.endsWith(".svg")) return [htmlLang()];
  return [];
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
  writingPath: string | null,
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
        <span className="flex items-center gap-1.5">
          {node.name}
          {writingPath === node.path && (
            <LoaderCircleIcon className="size-3 shrink-0 animate-spin opacity-60" />
          )}
        </span>
      </File>
    ) : (
      <Folder key={node.path} value={node.path} element={node.name}>
        {renderNodes(node.children, activeFileId, writingPath, openFile)}
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
  const closeOtherFiles = useProjectStore((s) => s.closeOtherFiles);
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
                  {isFileDirty(files[id]) && (
                    <span
                      aria-label="Unsaved changes"
                      title="Unsaved changes"
                      className="size-1.5 shrink-0 rounded-full bg-[var(--silver-600)] group-hover/tab:hidden"
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Close ${name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFile(id);
                    }}
                    className={cn(
                      "flex size-4 items-center justify-center rounded-[var(--radius-sm)] opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-[var(--space-void)]",
                      isFileDirty(files[id]) && "group-hover/tab:opacity-100",
                    )}
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
                  disabled={openFiles.length <= 1}
                  onSelect={() => closeOtherFiles(id)}
                >
                  <XIcon />
                  Close other tabs
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

/** Status line under the editor: why you can't type, or what the save is doing. */
function EditorStatus({
  file,
  isBuilding,
}: {
  file: ProjectFileState;
  isBuilding: boolean;
}) {
  if (isBuilding) {
    return (
      <span className="text-[var(--silver-600)]">
        Editing is paused while tau is building
      </span>
    );
  }
  if (file.saveError) {
    return <span className="text-[var(--danger, #f87171)]">{file.saveError}</span>;
  }
  if (file.saving) return <span className="text-[var(--silver-600)]">Saving…</span>;
  if (isFileDirty(file))
    return <span className="text-[var(--silver-600)]">Unsaved changes</span>;
  return <span className="text-[var(--silver-600)]">Saved</span>;
}

function CodeEditor() {
  const files = useProjectStore((s) => s.files);
  const activeFileId = useProjectStore((s) => s.activeFileId);
  const projectId = useProjectStore((s) => s.projectId);
  const setFileContent = useProjectStore((s) => s.setFileContent);
  const setFileDraft = useProjectStore((s) => s.setFileDraft);
  // The agent writes these same files. Rather than race it, edits are blocked
  // while a job is live: the api refuses them anyway (409).
  const isBuilding = useProjectStore((s) => s.status === "streaming");
  const file = activeFileId ? files[activeFileId] : undefined;

  const { flush, scheduleSave } = useFileSave(projectId ?? undefined);

  // Binary assets always need a fetch (for their presigned preview URL): their
  // in-store `content` is an empty placeholder from the file_start event, so the
  // usual `content === undefined` check would wrongly skip the load.
  const needsLoad =
    file !== undefined &&
    (file.content === undefined || isBinaryPath(activeFileId));
  const {
    data: fetched,
    isLoading,
    isError,
  } = useProjectFile(projectId ?? undefined, activeFileId, {
    enabled: needsLoad,
  });

  useEffect(() => {
    // Only text files carry `content`; binary assets return a preview URL and
    // must not be pushed into the (text) file buffer.
    if (fetched !== undefined && !fetched.binary && activeFileId) {
      setFileContent(activeFileId, fetched.content, fetched.contentHash);
    }
  }, [fetched, activeFileId, setFileContent]);

  // Flush a pending autosave when switching away from a dirty file, so edits
  // can't sit unsaved behind a tab the user has moved on from.
  const previousFileId = useRef(activeFileId);
  useEffect(() => {
    const previous = previousFileId.current;
    if (previous && previous !== activeFileId) flush(previous);
    previousFileId.current = activeFileId;
  }, [activeFileId, flush]);

  const handleChange = useCallback(
    (value: string) => {
      if (!activeFileId || isBuilding) return;
      setFileDraft(activeFileId, value);
      scheduleSave(activeFileId);
    },
    [activeFileId, isBuilding, setFileDraft, scheduleSave],
  );

  // Cmd/Ctrl+S saves now. Registered as a CodeMirror keybinding so it only
  // applies with focus in the editor and the browser's own save dialog is
  // suppressed.
  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            if (activeFileId) flush(activeFileId);
            return true;
          },
        },
      ]),
    [activeFileId, flush],
  );

  const extensions = useMemo(
    () => [
      ...languageFor(activeFileId ? basename(activeFileId) : ""),
      saveKeymap,
      EditorView.lineWrapping,
    ],
    [activeFileId, saveKeymap],
  );

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--space-void)]">
        <span
          className="logo-mark size-8 opacity-50 "
          role="img"
          aria-label="tau"
        />
        <span className="text-sm text-(--silver-600)">
          Select a file to view its contents
        </span>
      </div>
    );
  }

  // Binary assets (downloaded images, fonts, media) can't be shown in the text
  // editor: render a preview from the presigned URL the api hands back instead.
  if (isBinaryPath(activeFileId)) {
    return (
      <div className="flex h-full flex-col bg-[var(--space-void)]">
        <TabBar />
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          {isLoading ? (
            <LoaderCircleIcon className="size-5 animate-spin text-[var(--silver-600)]" />
          ) : isError || !fetched || !fetched.binary ? (
            <span className="text-sm text-[var(--silver-600)]">
              Could not load asset.
            </span>
          ) : IMAGE_EXTS.has(extOf(activeFileId)) ? (
            <img
              src={fetched.url}
              alt={basename(activeFileId)}
              className="max-h-full max-w-full rounded-md object-contain shadow-lg"
              // Checkerboard so transparent PNGs read as transparent, not black.
              style={{
                backgroundImage:
                  "linear-gradient(45deg,#2a2f3a 25%,transparent 25%),linear-gradient(-45deg,#2a2f3a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2f3a 75%),linear-gradient(-45deg,transparent 75%,#2a2f3a 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
              }}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-sm text-[var(--silver-600)]">
              <MaterialIcon
                name={basename(activeFileId)}
                className="size-10"
              />
              <span>{basename(activeFileId)}</span>
              <a
                href={fetched.url}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--blue-500)] hover:underline"
              >
                Open asset
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  // The draft is the source of truth while the user is typing; fall back to the
  // saved body, then to whatever the fetch just returned (text files only).
  const fetchedText = fetched && !fetched.binary ? fetched.content : undefined;
  const value = file.draft ?? file.content ?? fetchedText ?? "";

  return (
    <div className="flex h-full flex-col bg-[var(--space-void)]">
      <TabBar />
      {needsLoad && isLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--space-void)]">
          <LoaderCircleIcon className="size-5 animate-spin text-[var(--silver-600)]" />
        </div>
      ) : needsLoad && isError ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--space-void)] text-sm text-[var(--silver-600)]">
          Could not load file contents.
        </div>
      ) : (
        <>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
            <CodeMirror
              // Remount on file switch so undo history doesn't leak across files.
              key={activeFileId}
              value={value}
              theme={oneDark}
              extensions={extensions}
              editable={!isBuilding}
              onChange={handleChange}
              onBlur={() => activeFileId && flush(activeFileId)}
              basicSetup={{ foldGutter: false, highlightActiveLine: !isBuilding }}
              style={{ fontSize: "13px", fontFamily: "var(--mono)" }}
              height="100%"
              className="h-full [&_.cm-editor]:h-full [&_.cm-gutters]:border-none"
            />
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-[var(--silver-200)] bg-[var(--space-surface)] px-3 py-1 text-[11px]">
            <EditorStatus file={file} isBuilding={isBuilding} />
            {!isBuilding && isFileDirty(file) && !file.saving && (
              <button
                type="button"
                onClick={() => flush(file.path)}
                className="text-[var(--silver-600)] transition-colors hover:text-[var(--silver-900)]"
              >
                Save
                <span className="ml-1 opacity-60">⌘S</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function CodePane() {
  const files = useProjectStore((s) => s.files);
  const codeTreeWidth = useProjectStore((s) => s.codeTreeWidth);
  const setCodeTreeWidth = useProjectStore((s) => s.setCodeTreeWidth);
  const activeFileId = useProjectStore((s) => s.activeFileId);
  const writingPath = useProjectStore((s) => s.writingPath);
  const openFile = useProjectStore((s) => s.openFile);

  const containerRef = useRef<HTMLDivElement>(null);

  const paths = useMemo(() => Object.keys(files), [files]);
  const tree = useMemo(() => buildTree(paths), [paths]);
  const expanded = useMemo(() => folderPaths(tree), [tree]);
  // Re-mount the Tree (re-applying expanded folders) only when the folder
  // structure changes: not on every file content chunk.
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
            initialExpandedItems={[]}
          >
            {renderNodes(tree, activeFileId, writingPath, openFile)}
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
