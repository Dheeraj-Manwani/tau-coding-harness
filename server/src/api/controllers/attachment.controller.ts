import type { NextFunction, Request, Response } from "express";
import { parse } from "../lib/utils";
import {
  attachmentSignSchema,
  attachmentPasteSchema,
  attachmentIdParamSchema,
  attachmentCompleteSchema,
} from "../schemas/attachment.schema";
import * as attachmentService from "../services/attachment.service";
import { requireUserId } from "../middleware/auth.middleware";

export const uploadBytes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { attachmentId } = parse(attachmentIdParamSchema, req.params);
    await attachmentService.uploadBytes(userId, attachmentId, req.body);
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
};

export const signUpload = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const input = parse(attachmentSignSchema, req.body);
    const result = await attachmentService.signUpload(userId, input);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const completeUpload = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { attachmentId } = parse(attachmentIdParamSchema, req.params);
    const { userMessage } = parse(attachmentCompleteSchema, req.body ?? {});
    const result = await attachmentService.completeUpload(
      userId,
      attachmentId,
      userMessage,
    );
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
};

export const createPaste = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { text, filename } = parse(attachmentPasteSchema, req.body);
    const result = await attachmentService.createPaste(userId, text, filename);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const getAttachment = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { attachmentId } = parse(attachmentIdParamSchema, req.params);
    const result = await attachmentService.getAttachment(userId, attachmentId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const getAttachmentContent = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { attachmentId } = parse(attachmentIdParamSchema, req.params);
    const result = await attachmentService.getAttachmentContent(
      userId,
      attachmentId,
    );
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const getAttachmentUrl = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { attachmentId } = parse(attachmentIdParamSchema, req.params);
    const result = await attachmentService.getAttachmentUrl(
      userId,
      attachmentId,
    );
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const deleteAttachment = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { attachmentId } = parse(attachmentIdParamSchema, req.params);
    await attachmentService.deleteAttachment(userId, attachmentId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
