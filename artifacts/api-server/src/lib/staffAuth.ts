import crypto from "crypto";
import bcrypt from "bcryptjs";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const STAFF_COOKIE = "staff_sid";
export const STAFF_SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const STAFF_PREFIX = "staff_";

export interface StaffSessionData {
  staffUserId: number;
  email: string;
  name: string;
  role: string;
}

export async function createStaffSession(data: StaffSessionData): Promise<string> {
  const sid = STAFF_PREFIX + crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + STAFF_SESSION_TTL),
  });
  return sid;
}

export async function getStaffSession(sid: string): Promise<StaffSessionData | null> {
  if (!sid.startsWith(STAFF_PREFIX)) return null;
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.sid, sid));
  if (!row || row.expire < new Date()) {
    if (row) await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
    return null;
  }
  return row.sess as unknown as StaffSessionData;
}

export async function deleteStaffSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export function getStaffSessionId(req: Request): string | undefined {
  return req.cookies?.[STAFF_COOKIE];
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function setStaffCookie(res: Response, sid: string): void {
  res.cookie(STAFF_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STAFF_SESSION_TTL,
    path: "/",
  });
}

export function clearStaffCookie(res: Response): void {
  res.clearCookie(STAFF_COOKIE, { path: "/" });
}
