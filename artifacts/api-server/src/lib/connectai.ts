import { GoogleGenAI } from "@google/genai";
import type { Response } from "express";
import type { StoredReport } from "@workspace/db";

const aiRequestTimes = new Map<string, number[]>();
const messageRequestTimes = new Map<string, number[]>();
const conversationStreams = new Map<number, Set<Response>>();

function allowedByWindow(
  buckets: Map<string, number[]>,
  key: string,
  maximum: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const active = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
  if (active.length >= maximum) {
    buckets.set(key, active);
    return false;
  }
  active.push(now);
  buckets.set(key, active);
  return true;
}

export function allowAiRequest(userId: string): boolean {
  return allowedByWindow(aiRequestTimes, userId, 8, 60_000);
}

export function allowMessage(userId: string): boolean {
  return allowedByWindow(messageRequestTimes, userId, 30, 60_000);
}

export async function generateJson(prompt: string): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini is not configured.");
  }
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  });
  const text = response.text?.trim();
  if (!text) {
    throw new Error("The AI provider returned an empty response.");
  }
  return JSON.parse(text) as unknown;
}

export function asStoredReport(value: unknown): StoredReport {
  return value as StoredReport;
}

export function addConversationStream(
  conversationId: number,
  response: Response,
): () => void {
  const streams =
    conversationStreams.get(conversationId) ?? new Set<Response>();
  streams.add(response);
  conversationStreams.set(conversationId, streams);

  return () => {
    streams.delete(response);
    if (streams.size === 0) conversationStreams.delete(conversationId);
  };
}

export function publishConversationMessage(
  conversationId: number,
  message: unknown,
): void {
  const streams = conversationStreams.get(conversationId);
  if (!streams) return;
  const event = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
  for (const response of streams) {
    if (!response.writableEnded) response.write(event);
  }
}
