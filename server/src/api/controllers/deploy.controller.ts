import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/utils";
import { projectIdParamSchema } from "../schemas/project.schema";
import * as deployService from "../services/deploy.service";
import { requireUserId } from "../middleware/auth.middleware";

/** The address chosen for a first publish. Ignored once the project has one. */
const publishBodySchema = z.object({
  name: z.string().trim().max(80).optional(),
  /** Set when the owner confirmed the database changes a previous publish stopped for. */
  confirmSchemaChange: z.boolean().optional(),
});

const nameQuerySchema = z.object({ name: z.string().trim().min(1).max(80) });

export const nameAvailable = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const { name } = parse(nameQuerySchema, req.query);
    res.status(200).json(await deployService.checkNameAvailable(projectId, userId, name));
  } catch (err) {
    next(err);
  }
};

export const getStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    res.status(200).json(await deployService.getDeployStatus(projectId, userId));
  } catch (err) {
    next(err);
  }
};

export const publish = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const { name, confirmSchemaChange } = parse(publishBodySchema, req.body ?? {});
    // 202: the build runs as a job. The body carries the jobId to stream and the
    // URL the site will be at, which is already final — the slug is allocated
    // before the job is queued.
    res
      .status(202)
      .json(await deployService.requestDeploy(projectId, userId, name, confirmSchemaChange === true));
  } catch (err) {
    next(err);
  }
};

const rollbackParamSchema = projectIdParamSchema.extend({
  deploymentId: z.uuid("Invalid deployment id"),
});

// Rollback and take offline both answer with the panel's whole read model, the
// same body as `getStatus`: nothing runs as a job, so by the time they return
// the new state is the state.
export const rollback = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId, deploymentId } = parse(rollbackParamSchema, req.params);
    res
      .status(200)
      .json(await deployService.rollbackDeploy(projectId, deploymentId, userId));
  } catch (err) {
    next(err);
  }
};

export const getLogs = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    res.status(200).set("Cache-Control", "no-store").json(await deployService.getPublishedLogs(projectId, userId));
  } catch (err) {
    next(err);
  }
};

export const exportData = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const zip = await deployService.exportPublishedData(projectId, userId);
    res
      .status(200)
      .set({ "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="data-export.zip"', "Cache-Control": "no-store" })
      .send(Buffer.from(zip));
  } catch (err) {
    next(err);
  }
};

export const unpublish = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    res.status(200).json(await deployService.unpublish(projectId, userId));
  } catch (err) {
    next(err);
  }
};
