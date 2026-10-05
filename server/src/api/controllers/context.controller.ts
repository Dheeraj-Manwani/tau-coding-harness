import type { NextFunction, Request, Response } from "express";
import { parse } from "../lib/utils";
import { projectIdParamSchema } from "../schemas/project.schema";
import * as contextService from "../services/context.service";
import { requireUserId } from "../middleware/auth.middleware";

export const clearChat = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const result = await contextService.clearProjectChat(projectId, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const summarizeChat = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const result = await contextService.summarizeProjectChat(projectId, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};
