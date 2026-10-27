import {
  and,
  desc,
  eq,
  isNull,
  ne,
  or,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateConversationBody,
  CreateConversationResponse,
  DeleteMessageParams,
  ListConversationsResponse,
  ListMessagesParams,
  ListMessagesResponse,
  ListOlderMessagesParams,
  ListOlderMessagesResponse,
  SendMessageBody,
  SendMessageParams,
  SendMessageResponse,
  StreamConversationEventsParams,
} from "@workspace/api-zod";
import {
  conversationsTable,
  db,
  messagesTable,
  usersTable,
} from "@workspace/db";
import {
  addConversationStream,
  allowMessage,
  publishConversationMessage,
} from "../lib/connectai";
import {
  getConversationForUser,
  getConversationSummary,
  getConversationsForUser,
  getMessagePage,
  toMessage,
} from "./chatService";

const router: IRouter = Router();

router.get("/conversations", async (req, res): Promise<void> => {
  res.json(
    ListConversationsResponse.parse(
      await getConversationsForUser(req.userId!),
    ),
  );
});

router.post("/conversations", async (req, res): Promise<void> => {
  const parsed = CreateConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.participantId === req.userId) {
    res.status(400).json({ error: "You cannot start a chat with yourself." });
    return;
  }
  const [participant] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, parsed.data.participantId),
        eq(usersTable.profileVisibility, true),
      ),
    )
    .limit(1);
  if (!participant) {
    res.status(404).json({ error: "Registered user not found." });
    return;
  }

  const [first, second] = [req.userId!, parsed.data.participantId].sort();
  let [conversation] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.participantA, first),
        eq(conversationsTable.participantB, second),
      ),
    )
    .limit(1);
  if (!conversation) {
    [conversation] = await db
      .insert(conversationsTable)
      .values({ participantA: first, participantB: second })
      .onConflictDoNothing()
      .returning();
    if (!conversation) {
      [conversation] = await db
        .select()
        .from(conversationsTable)
        .where(
          and(
            eq(conversationsTable.participantA, first),
            eq(conversationsTable.participantB, second),
          ),
        )
        .limit(1);
    }
  }
  if (!conversation) {
    res.status(500).json({ error: "Conversation could not be created." });
    return;
  }
  const result = await getConversationSummary(conversation, req.userId!);
  if (!result) {
    res.status(500).json({ error: "Conversation could not be loaded." });
    return;
  }
  res.status(201).json(CreateConversationResponse.parse(result));
});

router.get(
  "/conversations/:conversationId/messages/before/:beforeId",
  async (req, res): Promise<void> => {
    const parsed = ListOlderMessagesParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const conversation = await getConversationForUser(
      parsed.data.conversationId,
      req.userId!,
    );
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    res.json(
      ListOlderMessagesResponse.parse(
        await getMessagePage(
          parsed.data.conversationId,
          parsed.data.beforeId,
        ),
      ),
    );
  },
);

router.get(
  "/conversations/:conversationId/messages",
  async (req, res): Promise<void> => {
    const parsed = ListMessagesParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const conversation = await getConversationForUser(
      parsed.data.conversationId,
      req.userId!,
    );
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    await db
      .update(messagesTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(messagesTable.conversationId, parsed.data.conversationId),
          ne(messagesTable.senderId, req.userId!),
          isNull(messagesTable.readAt),
        ),
      );
    res.json(
      ListMessagesResponse.parse(
        await getMessagePage(parsed.data.conversationId),
      ),
    );
  },
);

router.post(
  "/conversations/:conversationId/messages",
  async (req, res): Promise<void> => {
    const params = SendMessageParams.safeParse(req.params);
    const body = SendMessageBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (!body.data.content.trim()) {
      res.status(400).json({ error: "Message cannot be empty." });
      return;
    }
    if (!allowMessage(req.userId!)) {
      res.status(429).json({ error: "Please wait before sending more messages." });
      return;
    }
    const conversation = await getConversationForUser(
      params.data.conversationId,
      req.userId!,
    );
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    const [message] = await db
      .insert(messagesTable)
      .values({
        conversationId: params.data.conversationId,
        senderId: req.userId!,
        content: body.data.content.trim(),
      })
      .returning();
    await db
      .update(conversationsTable)
      .set({ updatedAt: message.createdAt })
      .where(eq(conversationsTable.id, conversation.id));
    const result = SendMessageResponse.parse(toMessage(message));
    publishConversationMessage(conversation.id, result);
    res.status(201).json(result);
  },
);

router.get(
  "/conversations/:conversationId/events",
  async (req, res): Promise<void> => {
    const parsed = StreamConversationEventsParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).end();
      return;
    }
    const conversation = await getConversationForUser(
      parsed.data.conversationId,
      req.userId!,
    );
    if (!conversation) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(": connected\n\n");
    const removeStream = addConversationStream(conversation.id, res);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": keep-alive\n\n");
    }, 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      removeStream();
    });
  },
);

router.delete("/messages/:messageId", async (req, res): Promise<void> => {
  const parsed = DeleteMessageParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [deleted] = await db
    .delete(messagesTable)
    .where(
      and(
        eq(messagesTable.id, parsed.data.messageId),
        eq(messagesTable.senderId, req.userId!),
      ),
    )
    .returning({ conversationId: messagesTable.conversationId });
  if (!deleted) {
    res.status(404).json({ error: "Message not found." });
    return;
  }
  const latest = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, deleted.conversationId))
    .orderBy(desc(messagesTable.id))
    .limit(1);
  const [latestMessage] = latest;
  await db
    .update(conversationsTable)
    .set({ updatedAt: latestMessage?.createdAt ?? new Date() })
    .where(eq(conversationsTable.id, deleted.conversationId));
  res.sendStatus(204);
});

export default router;
