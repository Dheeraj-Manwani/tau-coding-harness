import toast from "react-hot-toast";

export const SUCCESS_CELEBRATION_EVENT = "tau:success-celebration";

/** Only call after redemption or payment succeeds, never when checkout opens. */
export function celebrateSuccess(message: string): void {
  toast.success(message);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SUCCESS_CELEBRATION_EVENT));
  }
}
