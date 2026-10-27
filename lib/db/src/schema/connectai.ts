import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type StoredQuestion = {
  id: number;
  question: string;
  category: string;
};

export type StoredAnswer = {
  questionId: number;
  answer: string;
};

export type StoredReport = {
  overallScore: number;
  categoryScores: { category: string; score: number; reason: string }[];
  strengths: string[];
  weakAreas: string[];
  answerFeedback: {
    questionId: number;
    feedback: string;
    strengths: string[];
    improvements: string[];
    suggestedAnswer: string;
  }[];
  communicationFeedback: string;
  conceptsToReview: string[];
  recommendedQuestions: string[];
  sevenDayPlan: { day: number; focus: string; activity: string }[];
  disclaimer: string;
};

export const usersTable = pgTable(
  "connectai_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    bio: text("bio").notNull().default(""),
    profileVisibility: boolean("profile_visibility").notNull().default(true),
    showOnlineStatus: boolean("show_online_status").notNull().default(true),
    lastSeen: timestamp("last_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("connectai_users_email_idx").on(table.email)],
);

export const conversationsTable = pgTable(
  "connectai_conversations",
  {
    id: serial("id").primaryKey(),
    participantA: text("participant_a")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    participantB: text("participant_b")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("connectai_conversation_participants_unique").on(
      table.participantA,
      table.participantB,
    ),
    index("connectai_conversations_a_idx").on(table.participantA),
    index("connectai_conversations_b_idx").on(table.participantB),
  ],
);

export const messagesTable = pgTable(
  "connectai_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    index("connectai_messages_conversation_id_idx").on(table.conversationId),
    index("connectai_messages_conversation_order_idx").on(
      table.conversationId,
      table.id,
    ),
  ],
);

export const interviewsTable = pgTable(
  "connectai_interviews",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    experienceLevel: text("experience_level").notNull(),
    interviewType: text("interview_type").notNull(),
    difficulty: text("difficulty").notNull(),
    questionCount: integer("question_count").notNull(),
    language: text("language").notNull(),
    status: text("status").notNull().default("in_progress"),
    questions: jsonb("questions").$type<StoredQuestion[]>().notNull(),
    answers: jsonb("answers")
      .$type<StoredAnswer[]>()
      .notNull()
      .default([]),
    report: jsonb("report").$type<StoredReport>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("connectai_interviews_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);
