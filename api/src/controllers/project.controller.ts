import type { NextFunction, Request, Response } from "express";
import { parse } from "../lib/utils";
import {
  messageSchema,
  projectIdParamSchema,
  listMessagesQuerySchema,
  listProjectsQuerySchema,
  projectFileQuerySchema,
  projectFileSaveSchema,
  jobIdParamSchema,
  jobAnswerSchema,
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
    const { message, effort, attachmentIds } = parse(messageSchema, req.body);
    const result = await projectService.initializeProject(
      userId,
      message,
      effort,
      attachmentIds,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const listProjects = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { cursor, limit } = parse(listProjectsQuerySchema, req.query);
    const result = await projectService.listProjects(userId, { cursor, limit });
    res.status(200).json(result);
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
    const { cursor, before, limit } = parse(listMessagesQuerySchema, req.query);
    const result = await projectService.listMessages(projectId, userId, {
      cursor,
      before,
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
    const { message, effort, attachmentIds } = parse(messageSchema, req.body);
    const result = await projectService.addMessage(
      projectId,
      userId,
      message,
      effort,
      attachmentIds,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const getProjectTree = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const result = await projectService.getProjectTree(projectId, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const deleteProject = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    await projectService.deleteProject(projectId, userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const submitJobAnswer = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId, jobId } = parse(jobIdParamSchema, req.params);
    const { answer } = parse(jobAnswerSchema, req.body);
    await projectService.submitJobAnswer(projectId, jobId, userId, answer);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const cancelAllJobs = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const cancelled = await projectService.cancelAllActiveJobs(userId);
    res.status(200).json({ cancelled });
  } catch (err) {
    next(err);
  }
};

export const getProjectFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const { path } = parse(projectFileQuerySchema, req.query);
    const result = await projectService.getProjectFile(projectId, userId, path);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const saveProjectFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const { path, content, baseHash } = parse(projectFileSaveSchema, req.body);
    const result = await projectService.saveProjectFile(
      projectId,
      userId,
      path,
      content,
      baseHash,
    );
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const getPreviewStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const result = await projectService.getPreviewStatus(projectId, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const restartPreview = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const result = await projectService.restartPreview(projectId, userId);
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
};
