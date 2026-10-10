/**
 * `/storage` handlers: thin, so the rules stay in the service where the owner's
 * pane (S3) can reuse them. Errors are flat `{ error, code }`.
 */
import type { Request, Response } from "express";
import * as storage from "../services/storage.service";
import { StorageError } from "../lib/storageErrors";
import { captureException } from "../lib/log";

function handle(where: string, fn: (ctx: NonNullable<Request["storage"]>, req: Request) => Promise<unknown>, status = 200) {
  return async (req: Request, res: Response): Promise<void> => {
    const ctx = req.storage;
    if (!ctx) {
      res.status(401).json({ error: "Invalid storage key.", code: "invalid_api_key" });
      return;
    }
    try {
      res.status(status).json(await fn(ctx, req));
    } catch (err) {
      if (err instanceof StorageError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      captureException(err, { detail: `storage ${where} failed` });
      res.status(500).json({ error: "The tau storage service failed to handle this request.", code: "internal_error" });
    }
  };
}

const body = (req: Request) => (req.body && typeof req.body === "object" ? req.body : {});

export const createUpload = handle("createUpload", (ctx, req) => storage.createUpload(ctx, body(req)), 201);
export const completeUpload = handle("completeUpload", (ctx, req) => storage.completeUpload(ctx, String(req.params.id)));
export const listFiles = handle("listFiles", (ctx, req) => storage.listFiles(ctx, req.query));
export const fileInfo = handle("fileInfo", (ctx, req) => storage.fileInfo(ctx, req.query.key));
export const fileUrl = handle("fileUrl", (ctx, req) => storage.fileUrl(ctx, body(req)));
export const fileUrls = handle("fileUrls", (ctx, req) => storage.fileUrls(ctx, body(req)));
export const moveFile = handle("moveFile", (ctx, req) => storage.moveFile(ctx, body(req)));
export const deleteFiles = handle("deleteFiles", (ctx, req) => storage.deleteFiles(ctx, body(req)));
export const usage = handle("usage", (ctx) => storage.usage(ctx));
