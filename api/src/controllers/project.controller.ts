import type { NextFunction, Request, Response } from "express";
import { parse } from "../lib/utils";
import { messageSchema } from "../schemas/project.schema";
import * as projectService from "../services/project.service";

export const initializeProject = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { message } = parse(messageSchema, req.body);
    const user = await projectService.initializeProject(message);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
};
