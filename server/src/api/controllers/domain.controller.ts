import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/utils";
import { projectIdParamSchema } from "../schemas/project.schema";
import * as domains from "../services/domain.service";
import { requireUserId } from "../middleware/auth.middleware";

const domainParams = projectIdParamSchema.extend({ domainId: z.uuid("Invalid domain id") });
const addBody = z.object({ hostname: z.string().trim().min(1, "Enter a domain").max(300) });
const primaryBody = z.object({ primary: z.boolean() });

type Handler = (req: Request, res: Response, userId: string) => Promise<unknown>;

/** The same wrapper for every route here: authenticate, run, answer, forward errors. */
function route(fn: Handler, status = 200) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req, res, requireUserId(req)));
    } catch (err) {
      next(err);
    }
  };
}

export const list = route(async (req, _res, userId) => {
  const { projectId } = parse(projectIdParamSchema, req.params);
  return { cnameTarget: domains.cnameTarget(), domains: await domains.listDomains(projectId, userId) };
});

export const add = route(async (req, _res, userId) => {
  const { projectId } = parse(projectIdParamSchema, req.params);
  const { hostname } = parse(addBody, req.body);
  return domains.addDomain(projectId, userId, hostname);
}, 201);

export const check = route(async (req, _res, userId) => {
  const { projectId, domainId } = parse(domainParams, req.params);
  return domains.recheckDomain(projectId, domainId, userId);
});

export const primary = route(async (req, _res, userId) => {
  const { projectId, domainId } = parse(domainParams, req.params);
  const { primary } = parse(primaryBody, req.body);
  return { domains: await domains.setPrimary(projectId, domainId, userId, primary) };
});

export const remove = route(async (req, _res, userId) => {
  const { projectId, domainId } = parse(domainParams, req.params);
  return { domains: await domains.removeDomain(projectId, domainId, userId) };
});
