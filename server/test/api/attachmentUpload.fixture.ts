import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import express, { type Request, type Response, type NextFunction } from "express";
import { createHash } from "node:crypto";
import { AppError, Errors } from "@/api/lib/errors";

const bytes = Buffer.from([137, 80, 78, 71]);
const hash = createHash("sha256").update(bytes).digest("hex");
const id = "550e8400-e29b-41d4-a716-446655440000";
const base = { userId: "owner", status: "PENDING", sizeBytes: 4, contentHash: hash, blobKey: `tau/attachments/owner/${hash}`, mimeType: "image/png", messageId: null, feedbackId: null };
let row: Record<string, unknown> | null = { ...base };
const writes: { key: string; body: Buffer; mimeType: string }[] = [];
mock.module("@/lib/env", () => ({ env: { ATTACHMENTS_ENABLED: true, ATTACHMENT_MAX_BYTES: 16, ATTACHMENT_MAX_IMAGE_BYTES: 8 } }));
mock.module("@/lib/prisma", () => ({ prisma: { attachment: { findUnique: async () => row } } }));
mock.module("@/lib/s3", () => ({
  attachmentKey: (user: string, hash: string) => `tau/attachments/${user}/${hash}`,
  putAttachmentBytes: async (key: string, body: Buffer, mimeType: string) => { writes.push({ key, body, mimeType }); },
  deleteObject: async () => {}, objectExists: async () => false, presignGet: async () => "", presignPut: async () => "",
}));
mock.module("@/api/lib/attachments", () => ({
  maxBytesForMime: () => 8, isAllowedUpload: () => true, kindForMime: () => "IMAGE", runExtraction: async () => {}, truncate: (text: string) => text, PREVIEW_CHARS: 240,
}));
mock.module("@/api/middleware/auth.middleware", () => ({ requireUserId: (req: Request) => {
  if (!req.user) throw Errors.unauthorized();
  return req.user.id;
} }));
mock.module("@/api/middleware/rateLimit.middleware", () => ({ attachmentRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next() }));
const { default: routes } = await import("@/api/routes/attachment.routes");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  if (req.headers.authorization) req.user = { id: req.headers.authorization, email: "test@example.com" };
  next();
});
app.use("/attachments", routes);
app.use((error: AppError & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error.statusCode ?? error.status ?? 500).json({ error: error.message });
});
const server = app.listen(0);
const address = server.address() as { port: number };
const url = `http://127.0.0.1:${address.port}/attachments/${id}/upload`;
const send = (body = bytes, user = "owner", type = "application/octet-stream") => fetch(url, { method: "PUT", headers: { ...(user ? { Authorization: user } : {}), "Content-Type": type }, body });
beforeEach(() => { row = { ...base }; writes.length = 0; });
afterAll(() => server.close());

test("binary fallback passes through the global JSON parser and preserves stored MIME", async () => {
  expect((await send()).status).toBe(204);
  expect(writes).toEqual([{ key: base.blobKey, body: bytes, mimeType: "image/png" }]);
});
test("rejects unauthenticated and foreign uploads", async () => {
  expect((await send(bytes, "")).status).toBe(401);
  expect((await send(bytes, "stranger")).status).toBe(404);
  expect(writes).toHaveLength(0);
});
test("rejects already claimed or processing attachments", async () => {
  for (const change of [{ feedbackId: "feedback" }, { messageId: "message" }, { status: "READY" }, { status: "EXTRACTING" }]) {
    row = { ...base, ...change }; expect((await send()).status).toBe(409);
  }
  expect(writes).toHaveLength(0);
});
test("rejects wrong size and changed content without writing storage", async () => {
  expect((await send(Buffer.from([1]))).status).toBe(400);
  expect((await send(Buffer.from([1, 2, 3, 4]))).status).toBe(400);
  row = { ...base, blobKey: "some-other-object" };
  expect((await send()).status).toBe(400);
  expect(writes).toHaveLength(0);
});
test("limits body size and rejects JSON in place of file bytes", async () => {
  expect((await send(Buffer.alloc(17))).status).toBe(413);
  expect((await send(Buffer.from('{}'), "owner", "application/json")).status).toBe(400);
  expect(writes).toHaveLength(0);
});
