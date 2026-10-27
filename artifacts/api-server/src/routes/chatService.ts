import {
  and,
  desc,
  eq,
  isNull,
  lt,
  ne,
  or,
} from "drizzle-orm";
import {
  conversationsTable,
  db,
  messagesTable,
  usersTable,
} from "@workspace/db";

export type ChatMessage = typeof messagesTable.$inferSelect;

function toUserSummary(user: typeof usersTable.$inferSelect) {
  const visible = user.showOnlineStatus;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    bio: user.bio,
    isOnline: visible && Date.now() - user.lastSeen.getTime() < 60_000,
    lastSeen: visible ? user.lastSeen : null,
  };
}

export function toMessage(message: ChatMessage) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    content: message.content,
    createdAt: message.createdAt,
    readAt: message.readAt,
  };
}

export async function getConversationForUser(
  conversationId: number,
  userId: string,
) {
  const [conversation] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.id, conversationId),
        or(
          eq(conversationsTable.participantA, userId),
          eq(conversationsTable.participantB, userId),
        ),
      ),
    )
    .limit(1);
  return conversation;
}

export async function getConversationSummary(
  conversation: typeof conversationsTable.$inferSelect,
  userId: string,
) {
  const participantId =
    conversation.participantA === userId
      ? conversation.participantB
      : conversation.participantA;
  const [participant] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, participantId))
    .limit(1);
  if (!participant) return null;

  const [lastMessage] = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversation.id))
    .orderBy(desc(messagesTable.id))
    .limit(1);
  const unread = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conversation.id),
        ne(messagesTable.senderId, userId),
        isNull(messagesTable.readAt),
      ),
    );

  return {
    id: conversation.id,
    participant: toUserSummary(participant),
    lastMessage: lastMessage ? toMessage(lastMessage) : null,
    unreadCount: unread.length,
    updatedAt: conversation.updatedAt,
  };
}

export async function getConversationsForUser(userId: string) {
  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(
      or(
        eq(conversationsTable.participantA, userId),
        eq(conversationsTable.participantB, userId),
      ),
    )
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(100);
  const summaries = await Promise.all(
    conversations.map((conversation) =>
      getConversationSummary(conversation, userId),
    ),
  );
  return summaries.filter(
    (summary): summary is NonNullable<typeof summary> => summary !== null,
  );
}

export async function getMessagePage(
  conversationId: number,
  beforeId?: number,
) {
  const conditions = [eq(messagesTable.conversationId, conversationId)];
  if (beforeId !== undefined) conditions.push(lt(messagesTable.id, beforeId));
  const rows = await db
    .select()
    .from(messagesTable)
    .where(and(...conditions))
    .orderBy(desc(messagesTable.id))
    .limit(51);
  const hasMore = rows.length > 50;
  const page = rows.slice(0, 50).reverse().map(toMessage);
  return {
    items: page,
    nextBeforeId: hasMore ? page[0]?.id ?? null : null,
  };
}
