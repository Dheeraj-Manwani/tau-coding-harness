import { env } from "./env";
import { Errors } from "./errors";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RazorpayConstructor = require("razorpay") as typeof import("razorpay");

type RazorpayClient = InstanceType<typeof RazorpayConstructor>;

let _client: RazorpayClient | null = null;

export function getRazorpay(): RazorpayClient {
  if (_client) return _client;
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw Errors.badRequest(
      "Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing)",
    );
  }
  _client = new RazorpayConstructor({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
  return _client;
}
