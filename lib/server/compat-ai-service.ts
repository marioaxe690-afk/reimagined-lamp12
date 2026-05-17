import { CLARIFICATION_TURN_BUDGET } from "@/lib/ai-prompts";
import { mockAnalyzeInput, mockGenerateDeckFromPlan, mockGeneratePlanOptions, mockGenerateTaskFlow } from "@/lib/mock-ai";
import { backendPorts } from "@/lib/server/backend-services";
import { createImportReview } from "@/lib/server/import-coverage";
import { createPlanModeTurn } from "@/lib/server/plan-mode-service";
import { resolveMimoProviderConfig } from "@/lib/server/providers/mimo-ai-provider";
import type {
  AnalysisResult,
  ImportReviewResult,
  InputsState,
  PlanModeMessage,
  PlanModeTurnResult,
  PlanOption,
  SourceType,
  TaskDeck,
  TaskFlowState
} from "@/lib/types";

export type CompatPlanningBundle = {
  provider: "mimo" | "mock";
  analysis: AnalysisResult;
  options: PlanOption[];
  taskFlow: TaskFlowState;
  deck: TaskDeck;
  planMode: PlanModeTurnResult;
  notices: string[];
};

export type CompatClarificationMessage = {
  id?: string;
  role: "user" | "assistant" | "ai";
  content?: string;
  text?: string;
  createdAt?: string;
};

export type CompatClarificationRequest = {
  inputs: InputsState;
  messages: CompatClarificationMessage[];
};

export type CompatClarificationTurn = {
  provider: "mimo" | "mock" | "local-agent";
  status: "asking" | "ready";
  shouldPlan: boolean;
  assistantMessage: string;
  messages: CompatClarificationMessage[];
  questionCount: number;
  maxRounds: number;
  contextSummary: string;
  notices: string[];
  planMode: PlanModeTurnResult;
};

export type CompatParseInputRequest = {
  kind: "attachment" | "image";
  name: string;
  mimeType?: string;
  text?: string;
  dataUrl?: string;
};

export type CompatParsedInputResult = {
  sourceType: SourceType;
  parsedText: string;
  timeHints: string[];
  reminders: string[];
  provider: "mimo" | "local-skill";
  review: ImportReviewResult;
};

const MAX_CLARIFICATION_ROUNDS = CLARIFICATION_TURN_BUDGET;
const MAX_CLARIFICATION_MESSAGES = MAX_CLARIFICATION_ROUNDS * 2;

export async function createCompatPlanningBundle(inputs: InputsState): Promise<CompatPlanningBundle> {
  const normalizedInputs = normalizeInputs(inputs);
  const inputText = primaryInputText(normalizedInputs);
  const provider: CompatPlanningBundle["provider"] = resolveMimoProviderConfig() ? "mimo" : "mock";
  let planMode: PlanModeTurnResult;
  let resolvedProvider = provider;

  try {
    planMode = await backendPorts.aiPlanner.createPlanModeTurn({
      inputText,
      sourceType: normalizedInputs.sourceType,
      parsedText: mergedParsedText(normalizedInputs)
    });
  } catch {
    resolvedProvider = "mock";
    planMode = createPlanModeTurn({
      inputText,
      sourceType: normalizedInputs.sourceType,
      parsedText: mergedParsedText(normalizedInputs)
    });
  }

  const analysis = mergePlanModeAnalysis(mockAnalyzeInput(normalizedInputs), planMode);
  const options = mockGeneratePlanOptions(analysis);
  const taskFlow = mockGenerateTaskFlow(options[0]);
  const deck = mockGenerateDeckFromPlan(options[0], taskFlow, inputText);

  return {
    provider: resolvedProvider,
    analysis,
    options,
    taskFlow,
    deck,
    planMode,
    notices: [
      resolvedProvider === "mimo" ? "已通过 target 的 Mimo Plan Mode 后端入口规划。" : "Mimo 未配置或不可用，已使用本地规划后备。",
      "兼容 /api/ai/plan：输出旧前端可用的 analysis/options/taskFlow/deck。"
    ]
  };
}

export async function createCompatClarificationTurn(request: CompatClarificationRequest): Promise<CompatClarificationTurn> {
  const inputs = normalizeInputs(request.inputs);
  const cappedMessages = normalizeClarificationMessages(request.messages);
  const forceReady = cappedMessages.length >= MAX_CLARIFICATION_MESSAGES;
  const inputText = primaryInputText(inputs);
  let provider: CompatClarificationTurn["provider"] = resolveMimoProviderConfig() ? "mimo" : "local-agent";
  let planMode: PlanModeTurnResult;

  try {
    planMode = await backendPorts.aiPlanner.createPlanModeTurn({
      inputText,
      sourceType: inputs.sourceType,
      parsedText: mergedParsedText(inputs),
      messages: cappedMessages.map(toPlanModeMessage)
    });
  } catch {
    provider = "mock";
    planMode = createPlanModeTurn({
      inputText,
      sourceType: inputs.sourceType,
      parsedText: mergedParsedText(inputs),
      messages: cappedMessages.map(toPlanModeMessage)
    });
  }

  const shouldPlan = forceReady || planMode.shouldBuildNow;
  const assistantMessage = shouldPlan
    ? "分析完成：信息已经足够进入建牌。"
    : `分析完成：还缺 ${planMode.analysis.missingInformation.join("、") || "一个关键约束"}，可以补充，也可以先按默认建牌。`;
  const assistantTurn: CompatClarificationMessage = {
    id: `clarify-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    role: "assistant",
    content: assistantMessage,
    createdAt: new Date().toISOString()
  };
  const messages = cappedMessages.length >= MAX_CLARIFICATION_MESSAGES ? cappedMessages : [...cappedMessages, assistantTurn];

  return {
    provider,
    status: shouldPlan ? "ready" : "asking",
    shouldPlan,
    assistantMessage,
    messages: messages.slice(-MAX_CLARIFICATION_MESSAGES),
    questionCount: messages.filter((message) => message.role !== "user").length,
    maxRounds: MAX_CLARIFICATION_ROUNDS,
    contextSummary: buildContextSummary(inputs, messages),
    notices: forceReady ? [`已达到 ${MAX_CLARIFICATION_ROUNDS} 轮澄清上限，自动进入规划。`] : [],
    planMode: {
      ...planMode,
      status: shouldPlan ? "ready-to-build" : planMode.status,
      shouldBuildNow: shouldPlan
    }
  };
}

export async function createCompatParsedInput(input: CompatParseInputRequest): Promise<CompatParsedInputResult> {
  const sourceType: SourceType = input.kind === "image" ? "image" : "attachment";
  const imageDataUrl = normalizeImageDataUrl(input.dataUrl);
  const rawText = input.text?.trim() || "";
  const localFallbackText = rawText || `${input.name} 等待多模态解析。`;
  const provider: CompatParsedInputResult["provider"] = resolveMimoProviderConfig() ? "mimo" : "local-skill";
  let review: ImportReviewResult;
  let resolvedProvider = provider;

  try {
    review = await backendPorts.multimodalImportParser.parseImport({
      sourceType,
      rawText: rawText || (imageDataUrl ? "" : localFallbackText),
      attachmentName: input.name,
      imageDataUrl,
      imageMimeType: normalizeImageMimeType(input.mimeType)
    });
  } catch {
    resolvedProvider = "local-skill";
    review = createImportReview({ sourceType, rawText: localFallbackText });
  }

  const parsedText = review.topLevelCards.length > 0
    ? review.topLevelCards.map((card) => card.sourceLine).join("\n")
    : localFallbackText;

  return {
    sourceType,
    parsedText,
    timeHints: extractTimeHints(parsedText, review),
    reminders: buildReminderHints(parsedText, review),
    provider: resolvedProvider,
    review
  };
}

function normalizeInputs(inputs: InputsState): InputsState {
  return {
    text: inputs.text ?? "",
    attachments: Array.isArray(inputs.attachments) ? inputs.attachments : [],
    imageSchedule: inputs.imageSchedule ?? null,
    parsedText: inputs.parsedText ?? "",
    sourceType: inputs.sourceType ?? "text"
  };
}

function primaryInputText(inputs: InputsState) {
  return inputs.text.trim() || inputs.parsedText.trim() || inputs.imageSchedule?.parsedTimetable.trim() || "今日推进";
}

function mergedParsedText(inputs: InputsState) {
  return [inputs.parsedText, inputs.imageSchedule?.parsedTimetable].filter(Boolean).join("\n");
}

function mergePlanModeAnalysis(analysis: AnalysisResult, planMode: PlanModeTurnResult): AnalysisResult {
  return {
    ...analysis,
    goalUnderstanding: planMode.analysis.goalUnderstanding || analysis.goalUnderstanding,
    constraints: mergeUnique(analysis.constraints, planMode.analysis.knownConstraints),
    timeStrategy: mergeUnique(analysis.timeStrategy, [planMode.analysis.timeJudgement])
  };
}

function normalizeClarificationMessages(messages: CompatClarificationMessage[]) {
  return (Array.isArray(messages) ? messages : [])
    .map((message): CompatClarificationMessage => ({
      id: message.id,
      role: message.role === "ai" ? "assistant" : message.role,
      content: message.content ?? message.text ?? "",
      createdAt: message.createdAt ?? new Date().toISOString()
    }))
    .filter((message) => Boolean(message.content?.trim()))
    .slice(-MAX_CLARIFICATION_MESSAGES);
}

function toPlanModeMessage(message: CompatClarificationMessage): PlanModeMessage {
  return {
    role: message.role === "user" ? "user" : "assistant",
    content: message.content ?? message.text ?? "",
    createdAt: message.createdAt ?? new Date().toISOString()
  };
}

function buildContextSummary(inputs: InputsState, messages: CompatClarificationMessage[]) {
  return [
    inputs.text ? `当前输入：${inputs.text}` : "",
    inputs.parsedText ? `解析内容：${inputs.parsedText}` : "",
    inputs.imageSchedule?.parsedTimetable ? `图像课表：${inputs.imageSchedule.parsedTimetable}` : "",
    ...messages.map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content ?? message.text ?? ""}`)
  ]
    .filter(Boolean)
    .join("\n");
}

function extractTimeHints(parsedText: string, review: ImportReviewResult) {
  const fromCards = review.topLevelCards.map((card) => card.timeLabel).filter((value): value is string => Boolean(value));
  const fromText =
    parsedText.match(/(?:今天|今晚|明天|周[一二三四五六日天]|星期[一二三四五六日天])?\s*\d{1,2}[:：]\d{2}\s*(?:前|截止|上课)?/g) ?? [];

  return Array.from(new Set([...fromCards, ...fromText].map((item) => item.trim()).filter(Boolean)));
}

function buildReminderHints(parsedText: string, review: ImportReviewResult) {
  const reminders = review.topLevelCards
    .filter((card) => card.kind === "reminder")
    .map((card) => card.title);

  if (/提前|出门|上课|课表|教室/.test(parsedText)) {
    reminders.push("适合提前 20 分钟插入出门提醒");
  }

  if (/提交|截止|ddl|deadline/i.test(parsedText)) {
    reminders.push("适合截止前 30 分钟插入提交检查提醒");
  }

  return reminders.length > 0 ? Array.from(new Set(reminders)) : ["保留为轻提醒候选，等待调度 agent 判断是否插入。"];
}

function normalizeImageDataUrl(value: unknown) {
  return typeof value === "string" && /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(value.trim())
    ? value.trim().replace(/^data:image\/jpg/i, "data:image/jpeg")
    : undefined;
}

function normalizeImageMimeType(value: unknown) {
  return typeof value === "string" && /^image\/(?:jpeg|jpg|png|webp)$/i.test(value.trim())
    ? value.trim().toLowerCase().replace("image/jpg", "image/jpeg")
    : "image/jpeg";
}

function mergeUnique(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right].map((item) => item.trim()).filter(Boolean)));
}
