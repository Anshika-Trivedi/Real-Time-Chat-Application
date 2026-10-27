import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetDashboardResponse,
  GetMeResponse,
  SearchUsersQueryParams,
  SearchUsersResponse,
  UpdateMeBody,
  UpdateMeResponse,
} from "@workspace/api-zod";
import {
  db,
  interviewsTable,
  usersTable,
} from "@workspace/db";
import { getConversationsForUser } from "./chatService";

const router: IRouter = Router();

router.get("/me", async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (!user) {
    res.status(500).json({ error: "Profile is unavailable." });
    return;
  }
  const response = {
    id: user.id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    bio: user.bio,
    createdAt: user.createdAt,
    showOnlineStatus: user.showOnlineStatus,
    profileVisibility: user.profileVisibility,
  };
  res.json(GetMeResponse.parse(response));
});

router.patch("/me", async (req, res): Promise<void> => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, req.userId!))
    .returning();
  if (!user) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }
  req.currentUser = user;
  res.json(
    UpdateMeResponse.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      imageUrl: user.imageUrl,
      bio: user.bio,
      createdAt: user.createdAt,
      showOnlineStatus: user.showOnlineStatus,
      profileVisibility: user.profileVisibility,
    }),
  );
});

router.get("/users/search", async (req, res): Promise<void> => {
  const parsed = SearchUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const pattern = `%${parsed.data.q.trim()}%`;
  const users = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.profileVisibility, true),
        ne(usersTable.id, req.userId!),
        or(
          ilike(usersTable.name, pattern),
          ilike(usersTable.email, pattern),
        ),
      ),
    )
    .orderBy(usersTable.name)
    .limit(20);
  const now = Date.now();
  res.json(
    SearchUsersResponse.parse(
      users.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        imageUrl: candidate.imageUrl,
        bio: candidate.bio,
        isOnline:
          candidate.showOnlineStatus &&
          now - candidate.lastSeen.getTime() < 60_000,
        lastSeen: candidate.showOnlineStatus ? candidate.lastSeen : null,
      })),
    ),
  );
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (!user) {
    res.status(500).json({ error: "Profile is unavailable." });
    return;
  }
  const interviews = await db
    .select()
    .from(interviewsTable)
    .where(eq(interviewsTable.userId, user.id))
    .orderBy(desc(interviewsTable.createdAt))
    .limit(20);
  const completed = interviews.filter(
    (interview) => interview.status === "completed" && interview.report,
  );
  const scores = completed
    .map((interview) => interview.report?.overallScore)
    .filter((score): score is number => typeof score === "number");
  const conversations = await getConversationsForUser(user.id);
  const unreadMessages = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  );
  const response = {
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      imageUrl: user.imageUrl,
      bio: user.bio,
      createdAt: user.createdAt,
      showOnlineStatus: user.showOnlineStatus,
      profileVisibility: user.profileVisibility,
    },
    completedInterviews: completed.length,
    averageScore: scores.length
      ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
      : null,
    unreadMessages,
    recentInterviews: interviews.slice(0, 5),
    conversations: conversations.slice(0, 5),
  };
  res.json(GetDashboardResponse.parse(response));
});

export default router;
