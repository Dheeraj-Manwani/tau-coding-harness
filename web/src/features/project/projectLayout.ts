export type ProjectLayoutMode = "loading" | "chat" | "workspace";

type ProjectLayoutState = {
  /** A live file_start/preview_ready has already reached this browser tab. */
  liveBuildStarted: boolean;
  /** Persisted server marker returned by GET /project/:id. */
  workspaceStartedAt?: string | null;
  /** Compatibility fallback for projects created before the marker existed. */
  hasPreviewFragment?: boolean;
  /** Whether the project detail request is still unresolved. */
  detailPending: boolean;
  /** Fresh home navigation can render chat immediately without waiting. */
  freshBuild: boolean;
};

export function resolveProjectLayout({
  liveBuildStarted,
  workspaceStartedAt,
  hasPreviewFragment = false,
  detailPending,
  freshBuild,
}: ProjectLayoutState): ProjectLayoutMode {
  if (liveBuildStarted) return "workspace";
  if (!freshBuild && detailPending) return "loading";
  if (workspaceStartedAt || hasPreviewFragment) return "workspace";
  return "chat";
}
