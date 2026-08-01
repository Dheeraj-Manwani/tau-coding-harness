import type { NextFunction, Request, Response } from "express";
import { parse } from "../lib/utils";
import {
  projectIdParamSchema,
  githubPushSchema,
  githubLinkSchema,
  githubPatchSchema,
} from "../schemas/project.schema";
import * as githubProjectService from "../services/githubProject.service";
import { requireUserId } from "../middleware/auth.middleware";

/** GET /project/:projectId/github — panel state (repo, PRs, unpushed count). */
export const getInfo = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    res.status(200).json(await githubProjectService.getInfo(projectId, userId));
  } catch (err) {
    next(err);
  }
};

/** POST /project/:projectId/github/push — one-click push (commit + PR/commit). */
export const push = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const body = parse(githubPushSchema, req.body ?? {});
    res.status(200).json(await githubProjectService.push(projectId, userId, body));
  } catch (err) {
    next(err);
  }
};

/** GET /project/:projectId/github/repos — the user's repos for the link picker. */
export const repos = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    res
      .status(200)
      .json({ repos: await githubProjectService.repos(projectId, userId) });
  } catch (err) {
    next(err);
  }
};

/** POST /project/:projectId/github/link — link an existing owner/repo. */
export const link = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const { repo } = parse(githubLinkSchema, req.body);
    res
      .status(200)
      .json(await githubProjectService.link(projectId, userId, repo));
  } catch (err) {
    next(err);
  }
};

/** DELETE /project/:projectId/github/link — detach the repo from the project. */
export const unlink = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    await githubProjectService.unlink(projectId, userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

/** PATCH /project/:projectId/github — change visibility and/or default push mode. */
export const patch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const changes = parse(githubPatchSchema, req.body);
    res
      .status(200)
      .json(await githubProjectService.patch(projectId, userId, changes));
  } catch (err) {
    next(err);
  }
};
