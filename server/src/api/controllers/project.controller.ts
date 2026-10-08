import type { NextFunction, Request, Response } from "express";
import { parse } from "../lib/utils";
import {
  messageSchema,
  projectIdParamSchema,
  listMessagesQuerySchema,
  listProjectsQuerySchema,
  projectFileQuerySchema,
  projectFileSaveSchema,
  visualEditSchema,
  themeEditSchema,
  visualAssetSchema,
  jobIdParamSchema,
  jobAnswerSchema,
  secretAnswerSchema,
  secretParamSchema,
  secretValueSchema,
  updateProjectSchema,
} from "../schemas/project.schema";
import * as projectService from "../services/project.service";
import * as secretService from "../services/projectSecret.service";
import { requireUserId } from "../middleware/auth.middleware";

export const initializeProject = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { message, effort, attachmentIds, design } = parse(messageSchema, req.body);
    const result = await projectService.initializeProject(
      userId,
      message,
      effort,
      attachmentIds,
      design,
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
    const { cursor, limit, search } = parse(listProjectsQuerySchema, req.query);
    const result = await projectService.listProjects(userId, { cursor, limit, search });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const getProjectShowcase = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    res.set("Cache-Control", "private, no-store");
    res.json({ projects: await projectService.getProjectShowcase(userId) });
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

export const getProjectJobStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const result = await projectService.getProjectJobStatus(projectId, userId);
    res.set("Cache-Control", "no-store");
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
    const { message, effort, attachmentIds, visualContext, buildError, runtimeError } = parse(
      messageSchema,
      req.body,
    );
    const result = await projectService.addMessage(
      projectId,
      userId,
      message,
      effort,
      attachmentIds,
      { visual: visualContext, buildError, runtimeError },
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

export const updateProject = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const changes = parse(updateProjectSchema, req.body);
    const result = await projectService.updateProject(projectId, userId, changes);
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
    const { answer, questionId } = parse(jobAnswerSchema, req.body);
    await projectService.submitJobAnswer(projectId, jobId, userId, answer, questionId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const submitSecretAnswer = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId, jobId } = parse(jobIdParamSchema, req.params);
    const { questionId, values } = parse(secretAnswerSchema, req.body);
    const result = await secretService.submitSecretAnswer(
      projectId,
      jobId,
      userId,
      questionId,
      values,
    );
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const listSecrets = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    res.status(200).json(await secretService.listSecrets(projectId, userId));
  } catch (err) {
    next(err);
  }
};

export const setSecret = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId, name } = parse(secretParamSchema, req.params);
    const { value } = parse(secretValueSchema, req.body);
    await secretService.setSecret(projectId, userId, name, value);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const deleteSecret = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId, name } = parse(secretParamSchema, req.params);
    await secretService.deleteSecret(projectId, userId, name);
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

export const downloadProjectArchive = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const archive = await projectService.downloadProjectArchive(projectId, userId);
    res.setHeader("Cache-Control", "no-store");
    res.attachment(`project-${projectId}.zip`).send(archive);
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

export const applyVisualEdit = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const { loc, expectTag, baseHash, op } = parse(visualEditSchema, req.body);
    const result = await projectService.applyVisualEditToProject(
      projectId,
      userId,
      { loc, expectTag, baseHash, op },
    );
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const getProjectTheme = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const result = await projectService.getProjectTheme(projectId, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const applyThemeEdit = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const input = parse(themeEditSchema, req.body);
    const result = await projectService.applyThemeEditToProject(
      projectId,
      userId,
      input,
    );
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const importVisualAsset = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const { url } = parse(visualAssetSchema, req.body);
    const result = await projectService.importVisualAsset(
      projectId,
      userId,
      url,
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
