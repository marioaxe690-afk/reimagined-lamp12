import type { AIReplyPayload, ChatMessage, PlanOption, SourceType } from "@/lib/types";

export type ChatApiResponse = {
  payload: AIReplyPayload;
  fallback: boolean;
  provider?: "mimo" | "deepseek" | "local";
};

export type ChatApiContext = {
  contextNote?: string;
  sourceType?: SourceType;
  parsedText?: string;
  regenerate?: boolean;
  previousPlans?: PlanOption[];
};

export async function callChatApi(
  messages: ChatMessage[],
  contextOrNote?: string | ChatApiContext
): Promise<ChatApiResponse> {
  const ctx: ChatApiContext = typeof contextOrNote === "string" ? { contextNote: contextOrNote } : contextOrNote ?? {};

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      contextNote: ctx.contextNote,
      sourceType: ctx.sourceType,
      parsedText: ctx.parsedText,
      regenerate: ctx.regenerate === true ? true : undefined,
      previousPlans: ctx.previousPlans && ctx.previousPlans.length > 0 ? ctx.previousPlans : undefined
    })
  });

  if (!response.ok) {
    throw new Error(`chat api returned ${response.status}`);
  }

  return (await response.json()) as ChatApiResponse;
}
