import { type Request, type Response, type NextFunction } from "express";
import { getStaffSession, getStaffSessionId, type StaffSessionData } from "../lib/staffAuth";

declare global {
  namespace Express {
    interface Request {
      staffUser?: StaffSessionData;
    }
  }
}

export async function staffAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const sid = getStaffSessionId(req);
  if (!sid) { next(); return; }

  const session = await getStaffSession(sid);
  if (!session) { next(); return; }

  req.staffUser = session;

  if (!req.user) {
    req.user = {
      id: String(session.staffUserId),
      name: session.name,
      email: session.email,
      profileImageUrl: undefined,
    } as any;
  }

  next();
}

export function requireStaffAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.staffUser) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.staffUser || req.staffUser.role !== "super_admin") {
    res.status(403).json({ error: "Super admin access required" });
    return;
  }
  next();
}

// Allows Takundwa (and any future trusted app) to call protected endpoints
// using the x-api-key header, falling back to a normal staff session.
export function apiKeyOrSession(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"];
  if (apiKey && apiKey === process.env.TAKUNDWA_API_KEY) {
    return next();
  }
  if (req.staffUser) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}
