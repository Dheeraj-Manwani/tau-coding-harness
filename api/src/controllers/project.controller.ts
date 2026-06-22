import type { NextFunction, Request, Response } from "express";
import { parse } from "../lib/utils";
import {
  messageSchema,
  projectIdParamSchema,
  listMessagesQuerySchema,
} from "../schemas/project.schema";
import * as projectService from "../services/project.service";
import { requireUserId } from "../middleware/auth.middleware";

export const initializeProject = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { message } = parse(messageSchema, req.body);
    const result = await projectService.initializeProject(userId, message);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const getProject = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const result = await projectService.getProject(projectId, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const listMessages = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const { cursor, limit } = parse(listMessagesQuerySchema, req.query);
    const result = await projectService.listMessages(projectId, userId, {
      cursor,
      limit,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const addMessage = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const { message } = parse(messageSchema, req.body);
    const result = await projectService.addMessage(projectId, userId, message);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};
