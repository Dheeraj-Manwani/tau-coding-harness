import type { NextFunction, Request, Response } from "express";
import { parse } from "../lib/utils";
import { projectIdParamSchema } from "../schemas/project.schema";
import * as deployService from "../services/deploy.service";
import { requireUserId } from "../middleware/auth.middleware";

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
    // 202: the build runs as a job. The body carries the jobId to stream and the
    // URL the site will be at, which is already final — the slug is allocated
    // before the job is queued.
    res.status(202).json(await deployService.requestDeploy(projectId, userId));
  } catch (err) {
    next(err);
  }
};
