export type PreviewLoadPhase = "waiting" | "loaded" | "failed";
export type PreviewRecoveryState = { attempt: number; phase: PreviewLoadPhase; appError: boolean };

/** Bounded recovery for one URL/nonce. Neither an old frame nor load alone may
 * declare a monitored preview ready. Legacy previews must identify their runtime. */
export function createPreviewRecovery(options: {
  expectHealth: boolean;
  onChange: (state: PreviewRecoveryState) => void;
  timeoutMs?: number;
  retryDelayMs?: number;
  legacyDelayMs?: number;
}) {
  let state: PreviewRecoveryState = { attempt: 0, phase: "waiting", appError: false };
  let expectHealth = options.expectHealth;
  let legacyReady = false;
  let documentLoaded = false;
  let disposed = false;
  let retrying = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout>;
  let legacyTimer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); clearTimeout(legacyTimer); };
  const emit = () => { if (!disposed) options.onChange({ ...state }); };
  const watch = () => { timer = setTimeout(() => fail(true), options.timeoutMs ?? 15_000); };
  const fail = (transient: boolean) => {
    if (disposed || (retrying && transient) || state.phase !== "waiting") return;
    clear();
    if (transient && retries < 2) {
      retrying = true;
      timer = setTimeout(() => {
        if (disposed) return;
        retrying = false;
        retries++;
        state.attempt++;
        emit();
        watch();
      }, options.retryDelayMs ?? 1_000);
    } else {
      retrying = false;
      state = { ...state, phase: "failed", appError: !transient };
      emit();
    }
  };
  const loaded = () => {
    if (disposed || retrying || state.phase !== "waiting") return;
    clear();
    state.phase = "loaded";
    emit();
  };
  watch();
  const revealLegacy = () => {
    if (!expectHealth && legacyReady && documentLoaded && state.phase === "waiting" && !retrying) {
      clearTimeout(legacyTimer);
      legacyTimer = setTimeout(loaded, options.legacyDelayMs ?? 1_500);
    }
  };
  return {
    onLoad() {
      documentLoaded = true;
      revealLegacy();
    },
    onLegacyReady() { legacyReady = true; revealLegacy(); },
    onHealth(health: { state: string; transient?: boolean }) {
      expectHealth = true;
      clearTimeout(legacyTimer);
      if (health.state === "waiting" && state.phase === "loaded") {
        retries = 0;
        state = { ...state, phase: "waiting", appError: false };
        watch();
        emit();
      }
      if (health.state === "loaded") loaded();
      else if (health.state === "failed") fail(health.transient === true);
    },
    dispose() { disposed = true; clear(); },
  };
}
