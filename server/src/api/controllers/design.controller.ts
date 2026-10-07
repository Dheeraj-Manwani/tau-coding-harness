import type { NextFunction, Request, Response } from "express";
import { parse } from "../lib/utils";
import { Errors } from "../lib/errors";
import { designConfigSchema, projectIdParamSchema } from "../schemas/project.schema";
import * as designService from "../services/design.service";
import { requireUserId } from "../middleware/auth.middleware";
import { normalizeDesignConfig } from "@/worker/design/config";

export const getCatalog = (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(designService.getDesignCatalog());
  } catch (err) {
    next(err);
  }
};

export const getDesign = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const result = await designService.getProjectDesign(projectId, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const restyle = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const config = normalizeDesignConfig(parse(designConfigSchema, req.body));
    if (!config) throw Errors.badRequest("Nothing to change");
    const result = await designService.restyleProject(projectId, userId, config);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};
