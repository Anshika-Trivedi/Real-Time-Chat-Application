import { Router, type IRouter } from "express";
import {
  AskAssistantBody,
  AskAssistantResponse,
} from "@workspace/api-zod";
import { allowAiRequest, generateJson } from "../lib/connectai";

const router: IRouter = Router();

router.post("/assistant/chat", async (req, res): Promise<void> => {
  const parsed = AskAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!allowAiRequest(req.userId!)) {
    res.status(429).json({ error: "Please wait before making another AI request." });
    return;
  }
  try {
    const result = await generateJson(
      `You are ConnectAI, a supportive interview-preparation coach for college students. Explain concepts simply, help with HR answers, create practice questions for coding, SQL, OOP, DBMS, operating systems, and networks, and offer hints before full solutions. Give clear, specific feedback on incomplete or incorrect answers. Be honest and kind; do not claim to measure personality, confidence, or employability. Respond in the language used by the student where practical. Return JSON only in this shape: {"response":"..."}.\nStudent request: ${parsed.data.message}\nRelevant user-provided context, if any: ${parsed.data.context ?? "none"}`,
    );
    if (
      typeof result !== "object" ||
      result === null ||
      !("response" in result) ||
      typeof result.response !== "string" ||
      !result.response.trim()
    ) {
      throw new Error("AI returned an invalid assistant response.");
    }
    res.json(AskAssistantResponse.parse({ response: result.response }));
  } catch (error) {
    req.log.error({ err: error }, "Interview assistant request failed");
    res.status(503).json({
      error: "AI service is temporarily unavailable. Please try again.",
    });
  }
});

export default router;
