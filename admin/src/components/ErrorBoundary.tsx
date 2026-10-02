import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * One broken page must not blank the whole console during an incident — which
 * is exactly when a half-shaped API response is most likely. Keyed by route in
 * App so navigating away resets it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[admin] render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-xl border border-critical/40 bg-critical/8 p-5" role="alert">
        <h2 className="font-semibold text-critical-text">This page crashed while rendering</h2>
        <p className="mt-1 text-sm text-fg-2">
          Usually the API returned a shape this page didn't expect. Other pages still work.
        </p>
        <pre className="mt-3 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-fg-2">
          {this.state.error.message}
        </pre>
        <button
          type="button"
          className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
