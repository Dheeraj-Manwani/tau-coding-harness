/**
 * OpenAI-shaped error responses.
 *
 * Generated apps talk to `/v1` through the OpenAI SDK, which parses this exact
 * envelope to decide whether a failure is a `BadRequestError`, a
 * `RateLimitError`, an `AuthenticationError`, and so on. Returning tau's normal
 * `{ error: "..." }` shape instead would collapse every one of those into an
 * opaque `APIError`, so the app author could not handle them.
 */
import type { Response } from "express";

export type GatewayErrorType =
  | "invalid_request_error"
  | "insufficient_quota"
  | "rate_limit_error"
  | "api_error";

export interface GatewayErrorBody {
  message: string;
  type: GatewayErrorType;
  code: string;
  param?: string;
}

export function gatewayError(
  res: Response,
  status: number,
  body: GatewayErrorBody,
): void {
  res.status(status).json({
    error: {
      message: body.message,
      type: body.type,
      code: body.code,
      param: body.param ?? null,
    },
  });
}

/** Thrown inside the service, converted to a response at the controller edge. */
export class GatewayRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: GatewayErrorBody,
  ) {
    super(body.message);
    this.name = "GatewayRequestError";
  }
}
