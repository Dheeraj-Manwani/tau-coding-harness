import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/utils";
import { projectIdParamSchema } from "../schemas/project.schema";
import * as identityService from "../services/identity.service";
import { requireUserId } from "../middleware/auth.middleware";
import {
  DESCRIPTION_MAX,
  LOGO_MAX_BYTES,
  TITLE_MAX,
} from "../lib/appIdentity";

/** Base64 of a file at the size limit, with a little slack for padding. */
const B64_MAX = Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 8;

const saveSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX).optional(),
  description: z.string().trim().max(DESCRIPTION_MAX).optional(),
  logo: z
    .object({
      favicon: z.string().min(1).max(B64_MAX),
      icon512: z.string().min(1).max(B64_MAX),
      generationId: z.uuid().optional(),
    })
    .optional(),
});

export const get = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    res.status(200).json(await identityService.getIdentity(projectId, userId));
  } catch (err) {
    next(err);
  }
};

export const save = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    const body = parse(saveSchema, req.body);
    res.status(200).json(
      await identityService.saveIdentity(projectId, userId, {
        title: body.title,
        description: body.description,
        logo: body.logo && {
          favicon: new Uint8Array(Buffer.from(body.logo.favicon, "base64")),
          icon512: new Uint8Array(Buffer.from(body.logo.icon512, "base64")),
          generationId: body.logo.generationId,
        },
      }),
    );
  } catch (err) {
    next(err);
  }
};

export const generateLogo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { projectId } = parse(projectIdParamSchema, req.params);
    res.status(200).json(await identityService.generateLogo(projectId, userId));
  } catch (err) {
    next(err);
  }
};
