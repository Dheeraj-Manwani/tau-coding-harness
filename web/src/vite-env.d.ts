/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** The standalone ops console, linked from the admin-only menu item. */
  readonly VITE_ADMIN_URL?: string;
  readonly VITE_RAZORPAY_KEY_ID?: string;
  readonly VITE_LANDING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Razorpay checkout.js loaded via index.html script tag.
interface RazorpayOptions {
  key: string;
  subscription_id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  name?: string;
  description?: string;
  prefill?: { email?: string; name?: string };
  theme?: { color?: string };
  handler?: (response: {
    razorpay_payment_id: string;
    razorpay_subscription_id?: string;
    razorpay_order_id?: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayPaymentFailedResponse {
  error: {
    code: string;
    description: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: { order_id?: string; payment_id?: string };
  };
}

declare class RazorpayCheckout {
  constructor(options: RazorpayOptions);
  open(): void;
  on(
    event: "payment.failed",
    handler: (response: RazorpayPaymentFailedResponse) => void,
  ): void;
}

interface Window {
  Razorpay: typeof RazorpayCheckout;
}
