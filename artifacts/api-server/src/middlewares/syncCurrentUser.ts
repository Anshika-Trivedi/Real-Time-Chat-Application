import { clerkClient } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, usersTable } from "@workspace/db";

const clerkSyncCache = new Map<string, number>();

export async function syncCurrentUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  try {
    const [localUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const now = new Date();
    if (localUser && Date.now() - (clerkSyncCache.get(userId) ?? 0) < 300_000) {
      if (now.getTime() - localUser.lastSeen.getTime() > 30_000) {
        const [updated] = await db
          .update(usersTable)
          .set({ lastSeen: now })
          .where(eq(usersTable.id, userId))
          .returning();
        req.currentUser = updated;
      } else {
        req.currentUser = localUser;
      }
      next();
      return;
    }

    const clerkUser = await clerkClient.users.getUser(userId);
    const primaryEmail =
      clerkUser.emailAddresses.find(
        (address) => address.id === clerkUser.primaryEmailAddressId,
      ) ?? clerkUser.emailAddresses[0];
    if (
      !primaryEmail ||
      primaryEmail.verification?.status !== "verified"
    ) {
      res.status(403).json({ error: "A verified email address is required." });
      return;
    }

    const name =
      [clerkUser.firstName, clerkUser.lastName]
        .filter((part): part is string => Boolean(part))
        .join(" ")
        .trim() ||
      clerkUser.username ||
      primaryEmail.emailAddress.split("@")[0];

    const [profile] = await db
      .insert(usersTable)
      .values({
        id: userId,
        email: primaryEmail.emailAddress.toLowerCase(),
        name,
        imageUrl: clerkUser.imageUrl || null,
        lastSeen: now,
      })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: {
          email: primaryEmail.emailAddress.toLowerCase(),
          name,
          imageUrl: clerkUser.imageUrl || null,
          lastSeen: now,
        },
      })
      .returning();
    req.currentUser = profile;
    clerkSyncCache.set(userId, Date.now());
    next();
  } catch (error) {
    req.log.error({ err: error }, "Unable to synchronize authenticated user");
    res.status(503).json({
      error: "Your account could not be loaded. Please try again.",
    });
  }
}
