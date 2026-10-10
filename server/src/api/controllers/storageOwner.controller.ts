import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/utils";
import { projectIdParamSchema } from "../schemas/project.schema";
import * as owner from "../services/storageOwner.service";
import { requireUserId } from "../middleware/auth.middleware";

const envSchema = z.enum(["PREVIEW", "LIVE"]);
const key = z.string().min(1).max(512);

const listQuerySchema = z.object({
  env: envSchema.default("PREVIEW"),
  prefix: z.string().max(512).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const urlBodySchema = z.object({ env: envSchema.default("PREVIEW"), key, download: z.boolean().optional() });
const deleteBodySchema = z
  .object({
    env: envSchema.default("PREVIEW"),
    keys: z.array(key).min(1).max(1000).optional(),
    prefix: z.string().min(1).max(512).optional(),
  })
  .refine((v) => (v.keys === undefined) !== (v.prefix === undefined), { message: "Pass keys or a prefix" });

type Handler = (userId: string, projectId: string, req: Request) => Promise<unknown>;

const route =
  (fn: Handler) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireUserId(req);
      const { projectId } = parse(projectIdParamSchema, req.params);
      res.status(200).json(await fn(userId, projectId, req));
    } catch (err) {
      next(err);
    }
  };

export const getOverview = route((u, p) => owner.overview(p, u));
export const listFiles = route((u, p, req) => {
  const { env, ...q } = parse(listQuerySchema, req.query);
  return owner.listFiles(p, u, env, q);
});
export const fileUrl = route((u, p, req) => owner.fileUrl(p, u, parse(urlBodySchema, req.body)));
export const deleteFiles = route((u, p, req) => owner.deleteFiles(p, u, parse(deleteBodySchema, req.body)));
export const clearPreview = route((u, p) => owner.clearPreview(p, u));
