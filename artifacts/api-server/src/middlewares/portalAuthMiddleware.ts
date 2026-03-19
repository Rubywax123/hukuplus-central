import { type Request, type Response, type NextFunction } from "express";
import { getPortalSession, getPortalSessionId, type PortalSessionData } from "../lib/portalAuth";

declare global {
  namespace Express {
    interface Request {
      portalUser?: PortalSessionData;
      isPortalAuthenticated(): boolean;
    }
  }
}

export async function portalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  req.isPortalAuthenticated = function () {
    return this.portalUser != null;
  };

  const sid = getPortalSessionId(req);
  if (!sid) return next();

  const session = await getPortalSession(sid);
  if (session) req.portalUser = session;

  next();
}

export function requirePortalAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.portalUser) {
    res.status(401).json({ error: "Portal authentication required" });
    return;
  }
  next();
}

export function requirePortalAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.portalUser) {
    res.status(401).json({ error: "Portal authentication required" });
    return;
  }
  if (req.portalUser.role !== "retailer_admin") {
    res.status(403).json({ error: "Retailer admin access required" });
    return;
  }
  next();
}
