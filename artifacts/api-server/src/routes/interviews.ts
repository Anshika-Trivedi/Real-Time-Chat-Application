import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CompleteInterviewParams,
  CompleteInterviewResponse,
  CreateInterviewBody,
  CreateInterviewResponse,
  DeleteInterviewParams,
  GetInterviewParams,
  GetInterviewResponse,
  ListInterviewsResponse,
  SubmitInterviewAnswerBody,
  SubmitInterviewAnswerParams,
  SubmitInterviewAnswerResponse,
} from "@workspace/api-zod";
import { db, interviewsTable } from "@workspace/db";
import {
  allowAiRequest,
  asStoredReport,
  generateJson,
} from "../lib/connectai";

const router: IRouter = Router();

function aiUnavailable(req: Request, res: Response): void {
  req.log.error("Gemini request failed");
  res.status(503).json({
    error: "AI service is temporarily unavailable. Your work has not been lost.",
  });
}

router.get("/interviews", async (req, res): Promise<void> => {
  const interviews = await db
    .select()
    .from(interviewsTable)
    .where(eq(interviewsTable.userId, req.userId!))
    .orderBy(desc(interviewsTable.createdAt))
    .limit(100);
  res.json(ListInterviewsResponse.parse(interviews));
});

router.post("/interviews", async (req, res): Promise<void> => {
  const parsed = CreateInterviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!allowAiRequest(req.userId!)) {
    res.status(429).json({ error: "Please wait before making another AI request." });
    return;
  }

  const input = parsed.data;
  let questions: { id: number; question: string; category: string }[];
  try {
    const generated = await generateJson(
      `Create exactly ${input.questionCount} original mock interview questions as JSON with this shape: {"questions":[{"question":"...","category":"..."}]}. Role: ${input.role}. Experience: ${input.experienceLevel}. Interview type: ${input.interviewType}. Difficulty: ${input.difficulty}. Language: ${input.language}. Do not include answers, grading, markdown, or extra keys. Make questions relevant, fair, and distinct.`,
    );
    const records =
      typeof generated === "object" &&
      generated !== null &&
      "questions" in generated &&
      Array.isArray(generated.questions)
        ? generated.questions
        : null;
    if (!records || records.length !== input.questionCount) {
      throw new Error("AI returned an invalid question set.");
    }
    questions = records.map((item, index) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("question" in item) ||
        typeof item.question !== "string" ||
        !("category" in item) ||
        typeof item.category !== "string"
      ) {
        throw new Error("AI returned an invalid question.");
      }
      return {
        id: index,
        question: item.question,
        category: item.category,
      };
    });
  } catch (error) {
    req.log.error({ err: error }, "Interview question generation failed");
    aiUnavailable(req, res);
    return;
  }

  const [interview] = await db
    .insert(interviewsTable)
    .values({
      userId: req.userId!,
      role: input.role,
      experienceLevel: input.experienceLevel,
      interviewType: input.interviewType,
      difficulty: input.difficulty,
      questionCount: input.questionCount,
      language: input.language,
      questions,
    })
    .returning();
  res.status(201).json(CreateInterviewResponse.parse(interview));
});

router.get("/interviews/:interviewId", async (req, res): Promise<void> => {
  const parsed = GetInterviewParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [interview] = await db
    .select()
    .from(interviewsTable)
    .where(
      and(
        eq(interviewsTable.id, parsed.data.interviewId),
        eq(interviewsTable.userId, req.userId!),
      ),
    )
    .limit(1);
  if (!interview) {
    res.status(404).json({ error: "Interview not found." });
    return;
  }
  res.json(GetInterviewResponse.parse(interview));
});

router.post(
  "/interviews/:interviewId/answers",
  async (req, res): Promise<void> => {
    const params = SubmitInterviewAnswerParams.safeParse(req.params);
    const body = SubmitInterviewAnswerBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const [interview] = await db
      .select()
      .from(interviewsTable)
      .where(
        and(
          eq(interviewsTable.id, params.data.interviewId),
          eq(interviewsTable.userId, req.userId!),
        ),
      )
      .limit(1);
    if (!interview) {
      res.status(404).json({ error: "Interview not found." });
      return;
    }
    if (interview.status === "completed") {
      res.status(409).json({ error: "This interview is already complete." });
      return;
    }
    if (!interview.questions.some((question) => question.id === body.data.questionId)) {
      res.status(400).json({ error: "Question does not belong to this interview." });
      return;
    }
    const answers = [...interview.answers];
    const existingIndex = answers.findIndex(
      (answer) => answer.questionId === body.data.questionId,
    );
    const answer = {
      questionId: body.data.questionId,
      answer: body.data.answer,
    };
    if (existingIndex < 0) answers.push(answer);
    else answers[existingIndex] = answer;
    const [updated] = await db
      .update(interviewsTable)
      .set({ answers })
      .where(eq(interviewsTable.id, interview.id))
      .returning();
    res.json(SubmitInterviewAnswerResponse.parse(updated));
  },
);

router.post(
  "/interviews/:interviewId/complete",
  async (req, res): Promise<void> => {
    const params = CompleteInterviewParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [interview] = await db
      .select()
      .from(interviewsTable)
      .where(
        and(
          eq(interviewsTable.id, params.data.interviewId),
          eq(interviewsTable.userId, req.userId!),
        ),
      )
      .limit(1);
    if (!interview) {
      res.status(404).json({ error: "Interview not found." });
      return;
    }
    if (interview.status === "completed" && interview.report) {
      res.json(CompleteInterviewResponse.parse(interview));
      return;
    }
    if (!allowAiRequest(req.userId!)) {
      res.status(429).json({ error: "Please wait before making another AI request." });
      return;
    }

    const answers = new Map(
      interview.answers.map((answer) => [answer.questionId, answer.answer]),
    );
    const transcript = interview.questions.map((question) => ({
      questionId: question.id,
      category: question.category,
      question: question.question,
      answer: answers.get(question.id) ?? "",
    }));
    let report: unknown;
    try {
      report = await generateJson(
        `Evaluate this completed mock interview. Return only valid JSON matching this exact shape: {"overallScore":0,"categoryScores":[{"category":"Technical knowledge","score":0,"reason":"..."}],"strengths":["..."],"weakAreas":["..."],"answerFeedback":[{"questionId":0,"feedback":"...","strengths":["..."],"improvements":["..."],"suggestedAnswer":"..."}],"communicationFeedback":"...","conceptsToReview":["..."],"recommendedQuestions":["..."],"sevenDayPlan":[{"day":1,"focus":"...","activity":"..."}],"disclaimer":"..."}. Include scores 0-100 for technical knowledge, problem-solving and logical thinking, communication clarity, answer relevance, and HR/behavioral response quality when applicable. Explain each score in reason. Give answer-specific feedback for every question and a realistic improved answer for each. Make a useful 7-day plan. Leave no-answer questions clearly identified and do not treat them as evidence of ability. Do not infer personality, actual confidence, or employability from text. Say scores are estimates and may be imperfect. Distinguish correctness from communication quality.\\nInterview setup: ${JSON.stringify({ role: interview.role, experienceLevel: interview.experienceLevel, interviewType: interview.interviewType, difficulty: interview.difficulty, language: interview.language })}\\nActual questions and user responses: ${JSON.stringify(transcript)}`,
      );
    } catch (error) {
      req.log.error({ err: error }, "Interview evaluation failed");
      aiUnavailable(req, res);
      return;
    }
    const completedAt = new Date();
    const candidate = {
      ...interview,
      status: "completed",
      report: asStoredReport(report),
      completedAt,
    };
    const validated = CompleteInterviewResponse.safeParse(candidate);
    if (!validated.success) {
      req.log.error(
        { issues: validated.error.issues },
        "Gemini returned an invalid interview report",
      );
      res.status(502).json({
        error: "The AI report could not be validated. Please try again.",
      });
      return;
    }
    const [updated] = await db
      .update(interviewsTable)
      .set({
        status: "completed",
        report: asStoredReport(report),
        completedAt,
      })
      .where(eq(interviewsTable.id, interview.id))
      .returning();
    res.json(CompleteInterviewResponse.parse(updated));
  },
);

router.delete("/interviews/:interviewId", async (req, res): Promise<void> => {
  const parsed = DeleteInterviewParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [deleted] = await db
    .delete(interviewsTable)
    .where(
      and(
        eq(interviewsTable.id, parsed.data.interviewId),
        eq(interviewsTable.userId, req.userId!),
      ),
    )
    .returning({ id: interviewsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Interview not found." });
    return;
  }
  res.sendStatus(204);
});

export default router;
