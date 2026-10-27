import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import type { usersTable } from "@workspace/db";

type LocalUser = typeof usersTable.$inferSelect;

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      currentUser?: LocalUser;
    }
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  req.userId = userId;
  next();
}
