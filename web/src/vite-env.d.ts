/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_RAZORPAY_KEY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Razorpay checkout.js loaded via index.html script tag.
interface RazorpayOptions {
  key: string;
  subscription_id?: string;
  name?: string;
  description?: string;
  prefill?: { email?: string; name?: string };
  theme?: { color?: string };
  handler?: (response: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}

declare class RazorpayCheckout {
  constructor(options: RazorpayOptions);
  open(): void;
}

interface Window {
  Razorpay: typeof RazorpayCheckout;
}
