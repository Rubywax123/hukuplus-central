import crypto from "crypto";
import bcrypt from "bcryptjs";
import { type Request, type Response } from "express";
import { db, sessionsTable, portalUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { PortalUser } from "@workspace/db";

export const PORTAL_COOKIE = "portal_sid";
export const PORTAL_SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const PORTAL_PREFIX = "portal_";

export interface PortalSessionData {
  portalUserId: number;
  email: string;
  name: string;
  role: string;
  retailerId: number;
  branchId: number | null;
}

export async function createPortalSession(data: PortalSessionData): Promise<string> {
  const sid = PORTAL_PREFIX + crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + PORTAL_SESSION_TTL),
  });
  return sid;
}

export async function getPortalSession(sid: string): Promise<PortalSessionData | null> {
  if (!sid.startsWith(PORTAL_PREFIX)) return null;
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.sid, sid));
  if (!row || row.expire < new Date()) {
    if (row) await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
    return null;
  }
  return row.sess as unknown as PortalSessionData;
}

export async function deletePortalSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export function getPortalSessionId(req: Request): string | undefined {
  return req.cookies?.[PORTAL_COOKIE];
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function setPortalCookie(res: Response, sid: string): void {
  res.cookie(PORTAL_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PORTAL_SESSION_TTL,
    path: "/",
  });
}

export function clearPortalCookie(res: Response): void {
  res.clearCookie(PORTAL_COOKIE, { path: "/" });
}
