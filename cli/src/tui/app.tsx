import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Static, useApp, useInput } from "ink";
import { Session, type Mode, type SessionConfig } from "../agent/session.ts";
import type { Message } from "../providers/types.ts";
import { TuiBridge } from "./bridge.ts";
import { initialState, reducer, type Entry } from "./state.ts";
import { HELP_TEXT, parseSlash } from "./commands.ts";
import { Banner, type BannerProps } from "./components/Banner.tsx";
import { Row } from "./components/Row.tsx";
import { StatusLine } from "./components/StatusLine.tsx";
import { Input } from "./components/Input.tsx";
import { Overlay, type OverlayState } from "./components/Overlay.tsx";

/** Session config minus the wiring the App supplies itself (reporter + UI). */
export type BaseConfig = Omit<SessionConfig, "reporter" | "interaction">;

/** A header element rendered as the first {@link Static} item. */
type HeaderItem = { __header: true } & BannerProps;
/** Static feed: the one-time banner followed by committed transcript entries. */
type StaticItem = HeaderItem | Entry;

export function App({
  base,
  initialPrompt,
}: {
  base: BaseConfig;
  initialPrompt?: string;
}) {
  const { exit } = useApp();
  const bridge = useMemo(() => new TuiBridge(), []);
  const [state, dispatch] = useReducer(reducer, initialState);
  const [mode, setMode] = useState<Mode>(base.mode);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  // While exiting, the live region (input box + thinking line) is unmounted so
  // Ink rewrites those lines empty before the final teardown — leaving a clean
  // terminal instead of a stranded prompt. The actual exit() runs once that
  // empty frame has been committed.
  const [exiting, setExiting] = useState(false);
  useEffect(() => {
    if (exiting) exit();
  }, [exiting, exit]);

  // We took over Ctrl+C (exitOnCtrlC:false) so the cleanup above can run.
  useInput((input, key) => {
    if (key.ctrl && input === "c") setExiting(true);
  });

  // Build a session bound to this App's bridge (reporter + interaction UI).
  const makeSession = useCallback(
    (sessionMode: Mode, carry?: Message[]): Session => {
      const session = new Session({
        ...base,
        mode: sessionMode,
        reporter: bridge.reporter,
        interaction: bridge.interaction,
      });
      if (carry) session.messages.push(...carry);
      return session;
    },
    [base, bridge],
  );

  const sessionRef = useRef<Session | null>(null);
  if (sessionRef.current === null) sessionRef.current = makeSession(base.mode);

  // Fold agent-loop events into transcript state; route interaction requests to
  // an overlay instead (the reducer leaves those alone).
  useEffect(
    () =>
      bridge.onEvent((event) => {
        if (event.type === "confirm" || event.type === "select") {
          setOverlay(event);
        } else {
          dispatch(event);
        }
      }),
    [bridge],
  );

  const switchMode = useCallback(
    (target: Mode) => {
      const session = sessionRef.current!;
      if (session.mode === target) {
        dispatch({ type: "notice", text: `Already in ${target} mode.` });
        return;
      }
      sessionRef.current = makeSession(target, [...session.messages]);
      setMode(target);
      dispatch({ type: "notice", text: `Switched to ${target} mode.` });
    },
    [makeSession],
  );

  const runCommand = useCallback(
    (text: string) => {
      const command = parseSlash(text);
      switch (command.kind) {
        case "exit":
          setExiting(true);
          return;
        case "help":
          dispatch({ type: "notice", text: HELP_TEXT });
          return;
        case "info":
          dispatch({
            type: "notice",
            text: `${base.provider.name} · ${base.model} · ${sessionRef.current!.mode} mode · cwd ${base.cwd}`,
          });
          return;
        case "clear":
          sessionRef.current = makeSession(sessionRef.current!.mode);
          dispatch({ type: "clear" });
          dispatch({ type: "notice", text: "Conversation cleared." });
          return;
        case "switch-mode":
          switchMode(command.target);
          return;
        case "toggle-mode":
          switchMode(sessionRef.current!.mode === "plan" ? "build" : "plan");
          return;
        case "unknown":
          dispatch({
            type: "notice",
            text: `Unknown command: /${command.name} (try /help)`,
          });
          return;
      }
    },
    [base, makeSession, switchMode],
  );

  const handleSubmit = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || state.busy) return;
      if (text.startsWith("/")) {
        runCommand(text);
        return;
      }
      dispatch({ type: "submit-user", text });
      dispatch({ type: "step-begin" }); // instant status feedback before first model step
      void sessionRef.current!.send(text).finally(() => {
        dispatch({ type: "turn-done" });
        setMode(sessionRef.current!.mode); // a mid-turn switch_mode may have changed it
      });
    },
    [runCommand, state.busy],
  );

  // Auto-submit a command-line prompt once, after the first render.
  const firedInitial = useRef(false);
  useEffect(() => {
    if (firedInitial.current) return;
    firedInitial.current = true;
    if (initialPrompt && initialPrompt.trim()) handleSubmit(initialPrompt);
  }, [handleSubmit, initialPrompt]);

  const resolveOverlay = useCallback(
    (value: boolean | string | null) => {
      if (overlay) bridge.resolve(overlay.id, value);
      setOverlay(null);
    },
    [bridge, overlay],
  );

  // The streaming assistant entry (always the last) stays in the live region
  // until finalized; everything before it is committed to scrollback via Static.
  const streaming = state.streamingIndex !== null;
  const staticEntries = streaming
    ? state.entries.slice(0, state.streamingIndex!)
    : state.entries;
  const liveEntry = streaming ? state.entries[state.streamingIndex!] : null;

  const header: HeaderItem = {
    __header: true,
    provider: base.provider.name,
    model: base.model,
    mode: base.mode,
    cwd: base.cwd,
  };
  const staticItems: StaticItem[] = [header, ...staticEntries];

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>
        {(item, i) =>
          "__header" in item ? (
            <Banner key="banner" {...item} />
          ) : (
            <Row key={i} entry={item} />
          )
        }
      </Static>

      {liveEntry && <Row entry={liveEntry} />}

      {!exiting && (
        <Box flexDirection="column">
          <StatusLine
            busy={state.busy}
            label={state.statusLabel}
            waiting={!!overlay}
          />
          {overlay ? (
            <Overlay overlay={overlay} onResolve={resolveOverlay} />
          ) : (
            <Input mode={mode} isActive onSubmit={handleSubmit} />
          )}
        </Box>
      )}
    </Box>
  );
}
