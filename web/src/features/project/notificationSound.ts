let audioContext: AudioContext | null = null;

type WindowWithWebkitAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

function contextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ??
    (window as WindowWithWebkitAudio).webkitAudioContext;
}

/**
 * Browsers only allow sound after a user gesture. Prime one shared audio
 * context from the first click/key press, then reuse it when a run finishes.
 */
export async function primeNotificationSound(): Promise<void> {
  const AudioContextConstructor = contextConstructor();
  if (!AudioContextConstructor) return;

  audioContext ??= new AudioContextConstructor();
  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => {});
  }
}

/** Peak gain per volume. "soft" is for a user already looking at the project:
 *  an acknowledgement, not an alarm. */
const PEAK_GAIN = { soft: 0.045, full: 0.13 } as const;

/** Play a short two-note completion chime. Returns false when audio is blocked. */
export function playNotificationSound(
  volume: keyof typeof PEAK_GAIN = "full",
): boolean {
  const context = audioContext;
  if (!context || context.state !== "running") return false;

  const start = context.currentTime;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN[volume], start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.52);
  gain.connect(context.destination);

  for (const [frequency, offset] of [
    [880, 0],
    [1174.66, 0.16],
  ] as const) {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start + offset);
    oscillator.connect(gain);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.3);
  }

  return true;
}

/** Install one-shot gesture listeners that unlock notification audio. */
export function registerNotificationSoundUnlock(): () => void {
  if (typeof window === "undefined") return () => {};

  const unlock = () => {
    void primeNotificationSound();
    cleanup();
  };
  const cleanup = () => {
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };

  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  return cleanup;
}
