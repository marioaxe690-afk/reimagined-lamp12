"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  mockAnalyzeInput,
  mockGenerateClarifyingQuestion,
  mockGenerateDeckFromPlan,
  mockGeneratePlanOptions,
  mockGenerateProofSummary,
  mockGenerateTaskFlow,
  mockGenerateThinkingSteps,
  mockRegeneratePlanOptions
} from "@/lib/mock-ai";
import { callChatApi } from "@/lib/ai-client";
import { buildContextNote, CLARIFICATION_TURN_BUDGET } from "@/lib/ai-prompts";
import type {
  ActiveOverlay,
  AIReplyPayload,
  AnalysisResult,
  AnalysisStatus,
  ChatMessage,
  ClarificationAnswer,
  ClarifyingQuestion,
  DeckState,
  FrozenTaskEntry,
  InputsState,
  LastCompletion,
  Mode,
  PlanOption,
  PlansState,
  ProofRecord,
  ProofsState,
  RewardCard,
  TaskCard,
  TaskDeck,
  TaskFlowState,
  ThinkingStep,
  OverlayType,
  UploadedAttachment,
  UploadedImage
} from "@/lib/types";

const TURN_BUDGET_TOTAL = CLARIFICATION_TURN_BUDGET;

type NextCardStore = {
  mode: Mode;
  inputs: InputsState;
  analysis: AnalysisResult | null;
  analysisStatus: AnalysisStatus;
  thinkingSteps: ThinkingStep[];
  revealedThinkingCount: number;
  messages: ChatMessage[];
  isAiResponding: boolean;
  aiFallback: boolean;
  clarifyingQuestion: ClarifyingQuestion | null;
  clarificationAnswer: ClarificationAnswer | null;
  turnCount: number;
  plans: PlansState;
  taskFlow: TaskFlowState | null;
  deck: DeckState;
  proofs: ProofsState;
  activeOverlay: ActiveOverlay;
  lastCompletion?: LastCompletion;
  deckPanelOpen: boolean;
  focusCardMode: boolean;
  activePlanCatalogId?: string;
  setMode: (mode: Mode) => void;
  openOverlay: (type: OverlayType, id?: string) => void;
  closeOverlay: () => void;
  openPlanCatalog: () => void;
  openDeckCardDetail: (cardId: string) => void;
  openDeckCard: (deckId: string, cardId: string) => void;
  openDeckPanel: () => void;
  closeDeckPanel: () => void;
  toggleFocusCardMode: () => void;
  setInputText: (text: string) => void;
  addImageUpload: (file: File) => void;
  addDocumentUpload: (file: File) => void;
  removeInputAttachment: (id: string) => void;
  removeImageUpload: (id?: string) => void;
  submitInputForUnderstanding: () => void;
  sendChatMessage: (text: string) => Promise<void>;
  answerClarifyingQuestion: (optionId: string) => void;
  generatePlansFromClarification: () => void;
  resetInputDraft: () => void;
  regeneratePlans: () => void;
  selectPlan: (planId: PlanOption["id"]) => void;
  openDeck: (deckId: string) => void;
  completeCurrentCard: (direction: "left" | "right" | "button") => void;
  freezeCurrentDeck: () => void;
  failCurrentDeckByBurn: () => void;
  freezeCurrentCard: () => void;
  continueCurrentCard: () => void;
  startFocusTiming: () => void;
  startQuickBurning: () => void;
  /**
   * Mark a frozen-task entry as having had its return reminder fired. The
   * matching in-app proof note is written and the entry is removed from the
   * pending ledger. Called by FreezeReturnScheduler when the timer for an
   * entry reaches its returnAfter timestamp.
   */
  triggerFreezeReturn: (entryId: string) => void;
};

type PersistedNextCardState = Partial<
  Pick<
    NextCardStore,
    "inputs" | "analysis" | "analysisStatus" | "plans" | "taskFlow" | "deck" | "proofs"
  >
>;

const defaultInputs: InputsState = {
  text: "",
  attachments: [],
  imageSchedule: null,
  parsedText: "",
  sourceType: "text"
};

const defaultPlans: PlansState = {
  goalUnderstanding: "",
  constraints: [],
  timeStrategy: [],
  options: [],
  selectedPlanId: null,
  regenerateCount: 0
};

const defaultDeck: DeckState = {
  decks: [],
  activeDeckId: null,
  currentCardId: null,
  completedCardIds: [],
  frozenCardIds: [],
  rewardCards: [],
  rescheduleQueue: [],
  frozenTasks: [],
  activeTimeMode: "idle"
};

function makeDocumentAttachment(file: File): UploadedAttachment {
  return {
    id: `document-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    name: file.name || "未命名文档",
    kind: "document",
    mockedText: `正在解析文档「${file.name || "未命名文档"}」…`,
    size: file.size,
    mimeType: file.type || undefined
  };
}

function makeImageUpload(file: File): UploadedImage {
  return {
    id: `image-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    name: file.name || "已添加图片",
    parsedTimetable: `正在解析图片「${file.name || "图片"}」…`,
    size: file.size,
    mimeType: file.type || undefined
  };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsText(file);
  });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result);
    };
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

type ImportReviewResponse = {
  reviewRequired?: boolean;
  topLevelCards?: Array<{ id: string; title: string; sourceLine?: string; timeLabel?: string; kind?: string }>;
  dealNowCards?: Array<{ id: string; title: string; sourceLine?: string }>;
  hiddenBacklogCards?: Array<{ id: string; title: string; sourceLine?: string }>;
  userReviewPrompt?: string;
  error?: string;
  status?: number;
};

function friendlyImportError(error: string, status: number | undefined, fallbackName: string): string {
  if (status === 503 || /multimodal/i.test(error) || /imageDataUrl/i.test(error)) {
    return `「${fallbackName}」需要图像识别服务，但当前未配置。请直接在输入框补一句这张图的关键信息（例如课表内容/截止时间/事项），系统会按文字目标继续。`;
  }
  if (status === 502) {
    return `「${fallbackName}」识别服务暂时不可用，先把这张图的关键内容打字补进来吧。`;
  }
  if (status === 400) {
    return `「${fallbackName}」格式不被支持。建议改用 jpg/png/webp，或把内容粘贴成文字。`;
  }
  return `「${fallbackName}」未能解析（${error}）。先按目标说明继续，等一下再试上传。`;
}

function summarizeImportReview(result: ImportReviewResponse, fallbackName: string) {
  if (!result || result.error) {
    return friendlyImportError(result?.error ?? "无响应", result?.status, fallbackName);
  }

  const lines: string[] = [];
  if (result.userReviewPrompt) lines.push(result.userReviewPrompt);

  const top = result.topLevelCards ?? [];
  if (top.length > 0) {
    lines.push(`识别到 ${top.length} 项：`);
    top.slice(0, 8).forEach((card) => {
      const time = card.timeLabel ? `[${card.timeLabel}] ` : "";
      lines.push(`- ${time}${card.title}`);
    });
    if (top.length > 8) lines.push(`…还有 ${top.length - 8} 项`);
  }

  if ((result.dealNowCards ?? []).length > 0) {
    lines.push(`先发：${result.dealNowCards!.map((c) => c.title).join("、")}`);
  }

  return lines.length > 0 ? lines.join("\n") : `（${fallbackName} 已加入，但后端没识别到明确条目。先在输入框补一句关键信息。）`;
}

async function callImportReview(payload: Record<string, unknown>): Promise<ImportReviewResponse | null> {
  try {
    const res = await fetch("/api/backend/import/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = (await res.json().catch(() => null)) as ImportReviewResponse | null;
    if (!res.ok) {
      return { error: json?.error ?? `import/review failed: ${res.status}`, status: res.status };
    }
    return json;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "网络异常" };
  }
}

/**
 * Fire-and-forget worker tick. Sends the current deck state as a
 * BackendWorkerSnapshot so the backend's priority engine, freeze sweep, and
 * provider dispatch actually run against real data on key state transitions.
 *
 * The frontend does not currently apply the returned actions — the deck
 * state is still managed locally by useNextCardStore. This call ensures the
 * server-side scheduling pipeline is exercised (and logged) on every
 * meaningful change, which lets us verify the path is live.
 *
 * The snapshot is sent in *preview* mode (no `persist`, no `dispatch`) so
 * the worker route does not overwrite server-side queue truth nor trigger
 * Web Push from the client side. See app/api/backend/worker/tick/route.ts.
 *
 * `frozenTasks` is now populated from the store's frozen-task ledger so the
 * freeze-return agent (Agent 2) actually has something to sweep — without
 * this, the "we'll remind you to come back" promise was structurally
 * impossible to deliver because the agent always saw an empty list.
 */
function fireWorkerTick(
  deck: TaskDeck,
  analysis: AnalysisResult | null,
  frozenTasks: FrozenTaskEntry[],
  options?: { dispatch?: boolean }
): void {
  if (typeof window === "undefined") return;
  const now = new Date().toISOString();
  const queueItems = deck.cards.map((card) => ({
    id: card.id,
    title: card.title,
    kind: "card" as const,
    status:
      card.status === "frozen"
        ? ("frozen" as const)
        : card.status === "completed" || card.status === "rewarded"
          ? ("completed" as const)
          : card.status === "active"
            ? ("active" as const)
            : ("queued" as const),
    source: analysis?.sourceType ?? ("text" as const),
    createdAt: now,
    estimatedMinutes: card.estimatedMinutes ?? 8,
    deadlineAt: card.deadlineAt ?? undefined,
    suggestedStartAt: card.suggestedStartAt ?? undefined,
    urgencyStage: card.urgencyStage,
    deckId: deck.id,
    cardId: card.id,
    // Forward the AI-derived behavior vector so the priority engine and
    // schedule-planner actually see Agent 1's analysis. Without this, the
    // priority calculation regressed to default fallbacks every tick — the
    // two agents shared a data contract on paper only.
    behaviorVector: analysis?.behaviorVector,
    timeLocks: []
  }));

  void fetch("/api/backend/worker/tick", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      now,
      queueItems,
      activeQueue: queueItems.filter((q) => q.status === "queued" || q.status === "active").map((q) => q.id),
      timeLocks: [],
      // Carry the local freeze-return ledger so freeze-sweep can run a real
      // analyzeFrozenTaskReturn pass on every tick.
      frozenTasks,
      hiddenGoals: [],
      processedActionIds: [],
      // Default is preview-only. Callers that explicitly want the server to
      // dispatch reminders (e.g. the freeze-return timer firing) opt in.
      dispatch: options?.dispatch === true
    })
  }).catch(() => {
    // Intentionally swallow — this is observe-only. A failed tick must not
    // disrupt the user's local deck progress.
  });
}

function getParsedText(inputs: Pick<InputsState, "attachments" | "imageSchedule">) {
  return [
    ...inputs.attachments.map((attachment) => attachment.mockedText),
    inputs.imageSchedule?.parsedTimetable
  ].filter(Boolean).join("\n");
}

function getSourceType(inputs: Pick<InputsState, "text" | "attachments" | "imageSchedule">): InputsState["sourceType"] {
  const hasText = Boolean(inputs.text.trim());
  const hasAttachment = inputs.attachments.length > 0;
  const hasImage = Boolean(inputs.imageSchedule);
  const sourceCount = [hasText, hasAttachment, hasImage].filter(Boolean).length;

  if (sourceCount > 1) {
    return "mixed";
  }

  if (hasImage) {
    return "image";
  }

  if (hasAttachment) {
    return "attachment";
  }

  return "text";
}

const makeProofId = () => `proof-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
const makeRewardId = () => `reward-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
const makeMessageId = () => `msg-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
const makeFrozenEntryId = () => `frozen-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;

/**
 * Compute when the freeze-return agent should next consider this card.
 *
 * Strategy (matches the alignment agreed with the user):
 *   1. If the card has a real deadline, return 30 minutes before it.
 *   2. Otherwise use suggestedStartAt when it lies in the future.
 *   3. Otherwise fall back to now + 90 minutes.
 *
 * Past timestamps are skipped — a return reminder must always be in the
 * future, otherwise the agent would spam the user immediately on freeze.
 */
function computeFreezeReturnAfter(card: TaskCard, nowMs: number): string {
  const deadlineMs = card.deadlineAt ? new Date(card.deadlineAt).getTime() : NaN;
  if (Number.isFinite(deadlineMs)) {
    const guarded = deadlineMs - 30 * 60_000;
    if (guarded > nowMs) {
      return new Date(guarded).toISOString();
    }
  }

  const suggestedMs = card.suggestedStartAt ? new Date(card.suggestedStartAt).getTime() : NaN;
  if (Number.isFinite(suggestedMs) && suggestedMs > nowMs) {
    return new Date(suggestedMs).toISOString();
  }

  return new Date(nowMs + 90 * 60_000).toISOString();
}

function buildFrozenTaskEntry(card: TaskCard, deck: TaskDeck, nowIso: string): FrozenTaskEntry {
  const nowMs = new Date(nowIso).getTime();

  return {
    id: makeFrozenEntryId(),
    card,
    deckTitle: deck.coverTitle,
    frozenAt: nowIso,
    returnAfter: computeFreezeReturnAfter(card, nowMs),
    reason: "用户主动冻结，agent 将在 returnAfter 时点重新评估是否恢复。",
    minReentryMinutes: Math.max(3, Math.min(card.estimatedMinutes, 10)),
    contextSnapshot: [
      card.action,
      card.encouragement,
      card.cardBackNote
    ].filter(Boolean)
  };
}

/**
 * Render a returnAfter ISO string in the user's local time, used in proof
 * notes and reminder copy. Falls back to the raw ISO if the input is unusable.
 */
function formatReturnLabel(returnAfter: string): string {
  const date = new Date(returnAfter);
  if (Number.isNaN(date.getTime())) return returnAfter;
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getActualMinutes(card: TaskCard) {
  const startedSeconds = card.startedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(card.startedAt).getTime()) / 1000))
    : 0;
  const seconds = Math.max(card.elapsedSeconds, startedSeconds, Math.round(card.estimatedMinutes * 42));

  return Math.max(1, Math.ceil(seconds / 60));
}

function getDeckActualMinutes(cards: TaskCard[]) {
  return Math.max(
    1,
    cards.reduce((sum, card) => {
      if (card.status === "completed" || card.status === "rewarded" || card.startedAt) {
        return sum + getActualMinutes(card);
      }

      return sum;
    }, 0)
  );
}

function getNextCardId(cards: TaskCard[], currentIndex: number) {
  return cards.slice(currentIndex + 1).find((card) => card.status === "queued")?.id ?? null;
}

function updateFlowFromCards(taskFlow: TaskFlowState | null, cards: TaskCard[]): TaskFlowState | null {
  if (!taskFlow) {
    return null;
  }

  const completed = cards.filter((card) => card.status === "completed" || card.status === "rewarded").length;
  const overallProgress = cards.length === 0 ? 0 : Math.round((completed / cards.length) * 100);

  return {
    ...taskFlow,
    overallProgress,
    nodes: taskFlow.nodes.map((node) => {
      const nodeCards = cards.filter((card) => card.flowNodeId === node.id);
      const nodeDone = nodeCards.filter((card) => card.status === "completed" || card.status === "rewarded").length;
      const nodeFrozen = nodeCards.some((card) => card.status === "frozen");
      const nodeFailed = nodeCards.some((card) => card.status === "needs-review" && card.damageEffect === "burn");
      const nodeActive = nodeCards.some((card) => card.status === "active");

      if (nodeCards.length === 0) {
        return node;
      }

      return {
        ...node,
        status: nodeFailed ? "failed" : nodeFrozen ? "frozen" : nodeDone === nodeCards.length ? "completed" : nodeActive ? "active" : "not-started",
        progress: Math.round((nodeDone / nodeCards.length) * 100),
        urgencyStage: nodeFailed ? "expired" : nodeActive ? nodeCards.find((card) => card.status === "active")?.urgencyStage ?? node.urgencyStage : node.urgencyStage
      };
    })
  };
}

function lockFlowFromCards(
  taskFlow: TaskFlowState | null,
  cards: TaskCard[],
  lockStatus: "frozen" | "failed"
): TaskFlowState | null {
  if (!taskFlow) {
    return null;
  }

  const completed = cards.filter((card) => card.status === "completed" || card.status === "rewarded").length;
  const overallProgress = cards.length === 0 ? 0 : Math.round((completed / cards.length) * 100);

  return {
    ...taskFlow,
    overallProgress,
    nodes: taskFlow.nodes.map((node) => {
      const nodeCards = cards.filter((card) => card.flowNodeId === node.id);

      if (nodeCards.length === 0) {
        return node;
      }

      const nodeDone = nodeCards.filter((card) => card.status === "completed" || card.status === "rewarded").length;
      const locked = nodeDone === nodeCards.length ? "completed" : lockStatus;

      return {
        ...node,
        status: locked,
        progress: Math.round((nodeDone / nodeCards.length) * 100),
        urgencyStage: lockStatus === "failed" && locked !== "completed" ? "expired" : "calm"
      };
    })
  };
}

function replaceDeck(decks: TaskDeck[], updatedDeck: TaskDeck) {
  return decks.map((deck) => (deck.id === updatedDeck.id ? updatedDeck : deck));
}

function getDeckProofProgress(deck: TaskDeck, frozenCards = 0) {
  return {
    progress: deck.totalCards === 0 ? 0 : Math.round((deck.completedCards / deck.totalCards) * 100),
    completedCards: deck.completedCards,
    frozenCards
  };
}

function makeInitialProofRecord(
  generatedDeck: TaskDeck,
  selected: PlanOption,
  source: InputsState["sourceType"]
): ProofRecord {
  return {
    id: makeProofId(),
    deckId: generatedDeck.id,
    cardId: generatedDeck.cards[0]?.id,
    goalTitle: generatedDeck.coverTitle,
    source,
    status: "in-progress",
    progress: 0,
    completedCards: 0,
    frozenCards: 0,
    actualMinutes: 0,
    timeStatus: generatedDeck.cards[0]?.urgencyStage === "burning" ? "burning-completed" : "on-time",
    timeDamageEvents:
      generatedDeck.cards[0]?.damageEffect === "burn"
        ? ["生成第一张近截止燃烧演示卡"]
        : ["生成执行卡组"],
    lastDamageEffect: generatedDeck.cards[0]?.damageEffect === "burn" ? "burn" : undefined,
    lastAction: `选择${selected.name}并生成任务流`,
    nextSuggestion: "进入 deck,先完成第一张最小行动卡",
    createdAt: new Date().toISOString()
  };
}

function makeClarificationAnswer(
  question: ClarifyingQuestion | null,
  optionId?: string | null
): ClarificationAnswer | null {
  if (!question) {
    return null;
  }

  const option = question.options.find((item) => item.id === optionId) ??
    question.options.find((item) => item.id === question.defaultOptionId) ??
    question.options[0];

  if (!option) {
    return null;
  }

  return {
    questionId: question.id,
    optionId: option.id,
    label: option.label,
    effect: option.effect
  };
}

type StoreGet = () => NextCardStore;
type StoreSet = (
  partial: Partial<NextCardStore> | ((state: NextCardStore) => Partial<NextCardStore> | NextCardStore)
) => void;

function applyAnalysisPatch(
  current: AnalysisResult | null,
  fallback: AnalysisResult,
  patch: AIReplyPayload["analysis_patch"]
): AnalysisResult {
  const base = current ?? fallback;
  if (!patch) {
    return base;
  }

  return {
    ...base,
    goalUnderstanding: patch.goalUnderstanding ?? base.goalUnderstanding,
    constraints: patch.constraints && patch.constraints.length > 0 ? patch.constraints : base.constraints,
    stages: patch.stages ?? base.stages,
    timeStrategy: patch.timeStrategy && patch.timeStrategy.length > 0 ? patch.timeStrategy : base.timeStrategy,
    deadlineLabel: patch.deadlineLabel ?? base.deadlineLabel,
    availableWindow: patch.availableWindow ?? base.availableWindow,
    suggestedStart: patch.suggestedStart ?? base.suggestedStart,
    sourceType: patch.sourceType ?? base.sourceType
  };
}

function statusFromPhase(phase: AIReplyPayload["next_phase"]): AnalysisStatus {
  switch (phase) {
    case "thinking":
      return "thinking";
    case "asking":
      return "asking";
    case "generating":
      return "generating";
    case "ready":
      return "ready";
    default:
      return "thinking";
  }
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, "").replace(/[。?!,.,?!:;~""''「」]/g, "").toLowerCase();
}

function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = new Set(a.split(""));
  const setB = new Set(b.split(""));
  const intersection = [...setA].filter((c) => setB.has(c)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function detectRepetitiveQuestion(messages: ChatMessage[], newReply: string): boolean {
  const aiTexts = messages
    .filter((m) => m.role === "ai")
    .slice(-3)
    .map((m) => normalizeForCompare(m.text));
  const candidate = normalizeForCompare(newReply);

  if (candidate.length < 6) return false;

  return aiTexts.some((prev) => prev.length >= 6 && jaccardSimilarity(prev, candidate) > 0.78);
}

function enforceTurnBudget(
  payload: AIReplyPayload,
  turnCount: number,
  messages: ChatMessage[]
): AIReplyPayload {
  const used = turnCount + 1;
  const remaining = Math.max(0, TURN_BUDGET_TOTAL - used);

  if (remaining <= 0) {
    return {
      ...payload,
      next_phase: "ready",
      reply: payload.next_phase === "ready" ? payload.reply : "OK,我直接给你三套方案,不对再说。"
    };
  }

  if (remaining <= 1 && (payload.next_phase === "thinking" || payload.next_phase === "asking")) {
    return { ...payload, next_phase: "ready", reply: "够清楚了,直接看下面三个方案。" };
  }

  if (used >= 3 && payload.next_phase === "thinking") {
    return { ...payload, next_phase: "asking" };
  }

  if (detectRepetitiveQuestion(messages, payload.reply)) {
    if (payload.next_phase === "thinking" || payload.next_phase === "asking") {
      return { ...payload, next_phase: "ready", reply: "我刚才已经问过类似的——直接给你方案,不对再调。" };
    }
  }

  return payload;
}

async function requestAiTurn(get: StoreGet, set: StoreSet, opts?: { regenerate?: boolean }): Promise<void> {
  const state = get();
  const turnBudget = { used: state.turnCount, total: TURN_BUDGET_TOTAL };
  const contextNote = buildContextNote(state.inputs, turnBudget);

  try {
    const { payload: rawPayload, fallback } = await callChatApi(state.messages, {
      contextNote,
      sourceType: state.inputs.sourceType,
      parsedText: state.inputs.parsedText,
      regenerate: opts?.regenerate === true,
      previousPlans: opts?.regenerate === true ? state.plans.options : undefined
    });
    const payload = enforceTurnBudget(rawPayload, state.turnCount, state.messages);

    set((current) => {
      const aiMessage: ChatMessage = {
        id: makeMessageId(),
        role: "ai",
        text: payload.reply,
        tone:
          payload.next_phase === "asking"
            ? "uncertainty"
            : payload.next_phase === "generating" || payload.next_phase === "ready"
              ? "confirmation"
              : "understanding",
        createdAt: new Date().toISOString()
      };

      const baselineAnalysis = current.analysis ?? mockAnalyzeInput(current.inputs);
      const nextAnalysis = applyAnalysisPatch(current.analysis, baselineAnalysis, payload.analysis_patch);
      const nextStatus = statusFromPhase(payload.next_phase);

      const validatedQuestion =
        payload.question && payload.question.options?.length
          ? payload.question
          : payload.next_phase === "asking" || nextStatus === "asking"
            ? current.clarifyingQuestion ?? mockGenerateClarifyingQuestion(current.inputs, nextAnalysis)
            : current.clarifyingQuestion;

      const backendPlans = Array.isArray(payload.plans) && payload.plans.length > 0 ? payload.plans : null;
      const validatedPlans = backendPlans
        ? backendPlans
        : nextStatus === "ready"
          ? mockGeneratePlanOptions(nextAnalysis, current.clarificationAnswer)
          : current.plans.options;

      return {
        ...current,
        analysis: nextAnalysis,
        analysisStatus: nextStatus,
        isAiResponding: false,
        aiFallback: fallback,
        messages: [...current.messages, aiMessage],
        clarifyingQuestion: validatedQuestion ?? null,
        turnCount: current.turnCount + 1,
        plans: {
          ...current.plans,
          goalUnderstanding: nextAnalysis.goalUnderstanding,
          constraints: nextAnalysis.constraints,
          timeStrategy: nextAnalysis.timeStrategy,
          options: nextStatus === "ready" ? validatedPlans : current.plans.options,
          selectedPlanId: nextStatus === "ready" ? null : current.plans.selectedPlanId
        }
      };
    });
  } catch (error) {
    console.error("[ai] turn failed", error);
    set((current) => ({
      ...current,
      isAiResponding: false,
      aiFallback: true,
      messages: [
        ...current.messages,
        {
          id: makeMessageId(),
          role: "ai",
          text: "(连不上 AI 服务,再说一句或重试。)",
          tone: "uncertainty",
          createdAt: new Date().toISOString()
        }
      ]
    }));
  }
}

export const useNextCardStore = create<NextCardStore>()(
  persist(
    (set, get) => ({
      mode: "input",
      inputs: defaultInputs,
      analysis: null,
      analysisStatus: "idle",
      thinkingSteps: [],
      revealedThinkingCount: 0,
      messages: [],
      isAiResponding: false,
      aiFallback: false,
      clarifyingQuestion: null,
      clarificationAnswer: null,
      turnCount: 0,
      plans: defaultPlans,
      taskFlow: null,
      deck: defaultDeck,
      proofs: {
        records: [],
        summaryDocument: mockGenerateProofSummary([])
      },
      activeOverlay: null,
      lastCompletion: undefined,
      deckPanelOpen: false,
      focusCardMode: true,
      activePlanCatalogId: undefined,
      setMode: (mode) => set((state) => ({ mode, deckPanelOpen: mode === "deck" ? state.deckPanelOpen : false })),
      openOverlay: (type, id) => set({ activeOverlay: { type, id } }),
      closeOverlay: () => set({ activeOverlay: null }),
      openPlanCatalog: () =>
        set((state) => {
          const deckId = state.deck.activeDeckId ?? state.deck.decks[0]?.id;

          return {
            activePlanCatalogId: deckId,
            activeOverlay: { type: "plan-catalog-detail", id: deckId }
          };
        }),
      openDeckCardDetail: (cardId) => set({ activeOverlay: { type: "deck-card-detail", id: cardId } }),
      openDeckCard: (deckId, cardId) =>
        set((state) => {
          const targetDeck = state.deck.decks.find((deck) => deck.id === deckId);
          const locked = targetDeck?.deckStatus === "frozen" || targetDeck?.deckStatus === "failed" || targetDeck?.deckStatus === "completed";

          return {
            mode: "deck",
            activeOverlay: null,
            deckPanelOpen: false,
            focusCardMode: true,
            deck: {
              ...state.deck,
              activeDeckId: deckId,
              currentCardId: locked ? null : cardId
            }
          };
        }),
      openDeckPanel: () => set({ deckPanelOpen: true }),
      closeDeckPanel: () => set({ deckPanelOpen: false }),
      toggleFocusCardMode: () => set((state) => ({ focusCardMode: !state.focusCardMode })),
      setInputText: (text) =>
        set((state) => ({
          inputs: {
            ...state.inputs,
            text,
            sourceType: getSourceType({ ...state.inputs, text })
          }
        })),
      addImageUpload: (file) => {
        const imageSchedule = makeImageUpload(file);

        set((state) => ({
          inputs: {
            ...state.inputs,
            imageSchedule,
            parsedText: getParsedText({ attachments: state.inputs.attachments, imageSchedule }),
            sourceType: getSourceType({ ...state.inputs, imageSchedule })
          }
        }));

        void (async () => {
          const dataUrl = await readFileAsBase64(file);
          if (!dataUrl) return;
          const result = await callImportReview({
            sourceType: "image",
            attachmentName: file.name,
            imageDataUrl: dataUrl,
            imageMimeType: file.type || "image/jpeg"
          });
          const summary = summarizeImportReview(result ?? { error: "无响应" }, file.name || "图片");
          set((state) => {
            if (state.inputs.imageSchedule?.id !== imageSchedule.id) {
              return state;
            }
            const updated: UploadedImage = { ...state.inputs.imageSchedule, parsedTimetable: summary };
            return {
              inputs: {
                ...state.inputs,
                imageSchedule: updated,
                parsedText: getParsedText({ attachments: state.inputs.attachments, imageSchedule: updated })
              }
            };
          });
        })();
      },
      addDocumentUpload: (file) => {
        const attachment = makeDocumentAttachment(file);

        set((state) => {
          const attachments = [...state.inputs.attachments, attachment];
          return {
            inputs: {
              ...state.inputs,
              attachments,
              parsedText: getParsedText({ attachments, imageSchedule: state.inputs.imageSchedule }),
              sourceType: getSourceType({ ...state.inputs, attachments })
            }
          };
        });

        void (async () => {
          const text = await readFileAsText(file);
          const trimmed = text.trim();
          if (!trimmed) {
            set((state) => {
              const attachments = state.inputs.attachments.map((a) =>
                a.id === attachment.id ? { ...a, mockedText: `（${file.name || "文档"} 未读取到文本，请补充文字描述。）` } : a
              );
              return {
                inputs: {
                  ...state.inputs,
                  attachments,
                  parsedText: getParsedText({ attachments, imageSchedule: state.inputs.imageSchedule })
                }
              };
            });
            return;
          }

          const result = await callImportReview({
            sourceType: "attachment",
            attachmentName: file.name,
            rawText: trimmed.slice(0, 8000)
          });
          const summary = summarizeImportReview(result ?? { error: "无响应" }, file.name || "文档");
          set((state) => {
            const attachments = state.inputs.attachments.map((a) =>
              a.id === attachment.id ? { ...a, mockedText: summary } : a
            );
            return {
              inputs: {
                ...state.inputs,
                attachments,
                parsedText: getParsedText({ attachments, imageSchedule: state.inputs.imageSchedule })
              }
            };
          });
        })();
      },
      removeInputAttachment: (id) =>
        set((state) => {
          const attachments = state.inputs.attachments.filter((attachment) => attachment.id !== id);

          return {
            inputs: {
              ...state.inputs,
              attachments,
              parsedText: getParsedText({ attachments, imageSchedule: state.inputs.imageSchedule }),
              sourceType: getSourceType({ ...state.inputs, attachments })
            }
          };
        }),
      removeImageUpload: (id) =>
        set((state) => {
          if (id && state.inputs.imageSchedule?.id !== id) {
            return state;
          }

          return {
            inputs: {
              ...state.inputs,
              imageSchedule: null,
              parsedText: getParsedText({ attachments: state.inputs.attachments, imageSchedule: null }),
              sourceType: getSourceType({ ...state.inputs, imageSchedule: null })
            }
          };
        }),
      submitInputForUnderstanding: () => {
        const state = get();

        if (!state.inputs.text.trim() && state.inputs.attachments.length === 0 && !state.inputs.imageSchedule) {
          return;
        }

        const userText = state.inputs.text.trim() ||
          (state.inputs.imageSchedule?.parsedTimetable ?? state.inputs.parsedText ?? "");

        const userMessage: ChatMessage = {
          id: makeMessageId(),
          role: "user",
          text: userText,
          createdAt: new Date().toISOString()
        };

        const baselineAnalysis = mockAnalyzeInput(state.inputs);
        const baselineThinking = mockGenerateThinkingSteps(state.inputs, baselineAnalysis);

        set({
          analysis: baselineAnalysis,
          analysisStatus: "thinking",
          thinkingSteps: baselineThinking,
          revealedThinkingCount: 1,
          messages: [userMessage],
          isAiResponding: true,
          aiFallback: false,
          clarifyingQuestion: null,
          clarificationAnswer: null,
          turnCount: 0,
          plans: {
            ...defaultPlans,
            goalUnderstanding: baselineAnalysis.goalUnderstanding,
            constraints: baselineAnalysis.constraints,
            timeStrategy: baselineAnalysis.timeStrategy,
            regenerateCount: state.plans.regenerateCount
          },
          taskFlow: null
        });

        void requestAiTurn(get, set);
      },
      sendChatMessage: async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) {
          return;
        }

        const state = get();
        if (state.isAiResponding) {
          return;
        }

        const userMessage: ChatMessage = {
          id: makeMessageId(),
          role: "user",
          text: trimmed,
          createdAt: new Date().toISOString()
        };

        set({
          messages: [...state.messages, userMessage],
          isAiResponding: true,
          aiFallback: false
        });

        await requestAiTurn(get, set);
      },
      answerClarifyingQuestion: (optionId) => {
        const state = get();
        const baseAnalysis = state.analysis ?? mockAnalyzeInput(state.inputs);
        const question = state.clarifyingQuestion ?? mockGenerateClarifyingQuestion(state.inputs, baseAnalysis);
        const answer = makeClarificationAnswer(question, optionId);

        if (!answer || state.isAiResponding) {
          return;
        }

        const userMessage: ChatMessage = {
          id: makeMessageId(),
          role: "user",
          text: `我选「${answer.label}」。`,
          createdAt: new Date().toISOString()
        };

        set({
          analysisStatus: "generating",
          clarifyingQuestion: question,
          clarificationAnswer: answer,
          messages: [...state.messages, userMessage],
          isAiResponding: true,
          aiFallback: false,
          plans: {
            ...state.plans,
            options: [],
            selectedPlanId: null
          },
          taskFlow: null
        });

        void requestAiTurn(get, set);
      },
      generatePlansFromClarification: () => {
        const state = get();
        const baseAnalysis = state.analysis ?? mockAnalyzeInput(state.inputs);
        const question = state.clarifyingQuestion ?? mockGenerateClarifyingQuestion(state.inputs, baseAnalysis);
        const answer = state.clarificationAnswer ?? makeClarificationAnswer(question);

        if (!answer || state.isAiResponding) {
          return;
        }

        const userMessage: ChatMessage = {
          id: makeMessageId(),
          role: "user",
          text: `按默认理解(${answer.label})直接给方案。`,
          createdAt: new Date().toISOString()
        };

        set({
          analysisStatus: "generating",
          clarifyingQuestion: question,
          clarificationAnswer: answer,
          messages: [...state.messages, userMessage],
          isAiResponding: true,
          aiFallback: false,
          plans: {
            ...state.plans,
            options: [],
            selectedPlanId: null
          },
          taskFlow: null
        });

        void requestAiTurn(get, set);
      },
      resetInputDraft: () =>
        set({
          inputs: defaultInputs,
          analysis: null,
          analysisStatus: "idle",
          thinkingSteps: [],
          revealedThinkingCount: 0,
          messages: [],
          isAiResponding: false,
          aiFallback: false,
          clarifyingQuestion: null,
          clarificationAnswer: null,
          turnCount: 0,
          plans: defaultPlans,
          taskFlow: null
        }),
      regeneratePlans: () => {
        const state = get();

        if (state.isAiResponding) {
          return;
        }

        const userMessage: ChatMessage = {
          id: makeMessageId(),
          role: "user",
          text: "这三个方案不太对,再换一组。",
          createdAt: new Date().toISOString()
        };

        // Snapshot the current plans so the backend can use them as the
        // "previous plans" seed when truly regenerating, instead of
        // returning the same three options. We clear the visible options
        // so the user sees a regenerating state until the backend replies;
        // if the backend fails, the catch path in requestAiTurn will fall
        // back to the local mock without us pre-populating the slot here.
        const previousOptions = state.plans.options;

        set({
          analysisStatus: "generating",
          messages: [...state.messages, userMessage],
          isAiResponding: true,
          aiFallback: false,
          plans: {
            ...state.plans,
            options: [],
            selectedPlanId: null,
            regenerateCount: state.plans.regenerateCount + 1
          },
          taskFlow: null
        });

        // Mark this as a regenerate turn so the chat API actually rerolls
        // labels/timings via mockRegeneratePlanOptions instead of returning
        // the identical seed. If both backend providers are unreachable the
        // catch handler will keep the user from getting stuck.
        void requestAiTurn(get, set, { regenerate: true }).then(() => {
          // If the backend somehow returned no plans (e.g. it stayed in
          // asking despite this being a regenerate), restore the local
          // regenerated mock so the UI does not look frozen.
          const after = get();
          if (after.plans.options.length === 0) {
            const fallback = mockRegeneratePlanOptions(
              after.inputs,
              previousOptions,
              after.clarificationAnswer
            );
            set((current) => ({
              plans: {
                ...current.plans,
                options: fallback,
                selectedPlanId: null
              },
              analysisStatus: current.analysisStatus === "generating" ? "ready" : current.analysisStatus
            }));
          }
        });
      },
      selectPlan: (planId) => {
        const state = get();
        const selected = state.plans.options.find((option) => option.id === planId);

        if (!selected) {
          return;
        }

        const taskFlow = mockGenerateTaskFlow(selected);
        const goalTitle = state.inputs.text.trim() || (state.inputs.imageSchedule ? "去高数课" : "今日推进");
        const generatedDeck = mockGenerateDeckFromPlan(selected, taskFlow, goalTitle);
        const proofRecord = makeInitialProofRecord(generatedDeck, selected, state.inputs.sourceType);
        const records = [proofRecord, ...state.proofs.records];

        set({
          taskFlow,
          plans: {
            ...state.plans,
            selectedPlanId: planId
          },
          deck: {
            ...state.deck,
            decks: [generatedDeck, ...state.deck.decks.filter((deck) => deck.coverTitle !== generatedDeck.coverTitle)],
            activeDeckId: generatedDeck.id,
            currentCardId: generatedDeck.cards[0]?.id ?? null
          },
          proofs: {
            records,
            summaryDocument: mockGenerateProofSummary(records)
          }
        });
      },
      openDeck: (deckId) =>
        set((state) => {
          const deck = state.deck.decks.find((item) => item.id === deckId);
          const locked = deck?.deckStatus === "frozen" || deck?.deckStatus === "failed" || deck?.deckStatus === "completed";

          return {
            mode: "deck",
            deckPanelOpen: false,
            focusCardMode: true,
            deck: {
              ...state.deck,
              activeDeckId: deckId,
              currentCardId: locked
                ? null
                : deck?.cards.find((card) => card.status === "active")?.id ?? deck?.cards.find((card) => card.status === "queued")?.id ?? null
            }
          };
        }),
      startFocusTiming: () =>
        set((state) => {
          const activeDeck = state.deck.decks.find((deck) => deck.id === state.deck.activeDeckId);
          const currentCard = activeDeck?.cards.find((card) => card.id === state.deck.currentCardId);

          if (!activeDeck || !currentCard || activeDeck.deckStatus === "frozen" || activeDeck.deckStatus === "failed" || activeDeck.deckStatus === "completed") {
            return state;
          }

          const cards = activeDeck.cards.map((card) =>
            card.id === currentCard.id
              ? {
                  ...card,
                  startedAt: card.startedAt ?? new Date().toISOString(),
                  status: "active" as const
                }
              : card
          );
          const updatedDeck = { ...activeDeck, deckStatus: "active" as const, cards };
          const proofRecord: ProofRecord = {
            id: makeProofId(),
            deckId: activeDeck.id,
            cardId: currentCard.id,
            goalTitle: activeDeck.coverTitle,
            source: state.inputs.sourceType,
            status: "in-progress",
            ...getDeckProofProgress(updatedDeck, state.deck.frozenCardIds.length),
            actualMinutes: 0,
            timeStatus: "on-time",
            timeDamageEvents: ["双击卡片,开始专注计时"],
            lastAction: `开始计时:${currentCard.title}`,
            nextSuggestion: "完成这张卡,或下滑查看状态后选择冻结",
            createdAt: new Date().toISOString()
          };
          const records = [proofRecord, ...state.proofs.records];

          return {
            deck: {
              ...state.deck,
              decks: replaceDeck(state.deck.decks, updatedDeck),
              activeTimeMode: "timing"
            },
            proofs: {
              records,
              summaryDocument: mockGenerateProofSummary(records)
            }
          };
        }),
      failCurrentDeckByBurn: () =>
        set((state) => {
          const activeDeck = state.deck.decks.find((deck) => deck.id === state.deck.activeDeckId);
          const currentCard = activeDeck?.cards.find((card) => card.id === state.deck.currentCardId);

          if (!activeDeck || activeDeck.deckStatus === "frozen" || activeDeck.deckStatus === "failed" || activeDeck.deckStatus === "completed") {
            return state;
          }

          const cards = activeDeck.cards.map((card) =>
            card.status === "completed" || card.status === "rewarded"
              ? card
              : {
                  ...card,
                  startedAt: card.id === currentCard?.id ? card.startedAt ?? new Date().toISOString() : card.startedAt,
                  status: "needs-review" as const,
                  urgencyStage: "expired" as const,
                  damageEffect: "burn" as const,
                  damageProgress: 100,
                  burnLevel: 3 as const,
                  remainingSeconds: 0,
                  cardBackNote: "这组任务已经因燃烧失败锁定,不能继续打卡。"
                }
          );
          const completedCount = cards.filter((card) => card.status === "completed" || card.status === "rewarded").length;
          const updatedDeck: TaskDeck = {
            ...activeDeck,
            deckStatus: "failed",
            cards,
            completedCards: completedCount
          };
          const proofRecord: ProofRecord = {
            id: makeProofId(),
            deckId: activeDeck.id,
            goalTitle: activeDeck.coverTitle,
            source: state.inputs.sourceType,
            status: "failed",
            ...getDeckProofProgress(updatedDeck, cards.filter((card) => card.status === "frozen").length),
            actualMinutes: getDeckActualMinutes(activeDeck.cards),
            timeStatus: "expired",
            timeDamageEvents: ["上滑触发燃烧失败,整组任务停止后续打卡"],
            lastDamageEffect: "burn",
            lastAction: `任务失败:${activeDeck.coverTitle}`,
            nextSuggestion: "该任务已锁定。需要重做时,请从 Input 新建一个新任务。",
            createdAt: new Date().toISOString()
          };
          const records = [proofRecord, ...state.proofs.records];

          return {
            taskFlow: lockFlowFromCards(state.taskFlow, cards, "failed"),
            deck: {
              ...state.deck,
              decks: replaceDeck(state.deck.decks, updatedDeck),
              currentCardId: null,
              activeTimeMode: "idle"
            },
            proofs: {
              records,
              summaryDocument: mockGenerateProofSummary(records)
            }
          };
        }),
      startQuickBurning: () => get().failCurrentDeckByBurn(),
      triggerFreezeReturn: (entryId: string) => {
        const state = get();
        const entry = state.deck.frozenTasks.find((item) => item.id === entryId);
        if (!entry) {
          return;
        }

        const remaining = state.deck.frozenTasks.filter((item) => item.id !== entryId);
        const proofRecord: ProofRecord = {
          id: makeProofId(),
          deckId: entry.card.deckId,
          cardId: entry.card.id,
          goalTitle: entry.deckTitle,
          source: state.inputs.sourceType,
          status: "in-progress",
          progress: 0,
          completedCards: 0,
          frozenCards: state.deck.frozenCardIds.length,
          actualMinutes: 0,
          timeStatus: "frozen-rescheduled",
          timeDamageEvents: [
            `冻结回归提醒触发：${formatReturnLabel(entry.returnAfter)}`,
            `建议先做 ${entry.minReentryMinutes} 分钟内的最小动作。`
          ],
          lastDamageEffect: "freeze",
          lastAction: `回归提醒：${entry.card.title}`,
          nextSuggestion: `打开 deck，先恢复「${entry.card.title}」的上下文。`,
          createdAt: new Date().toISOString()
        };
        const records = [proofRecord, ...state.proofs.records];

        set({
          deck: {
            ...state.deck,
            frozenTasks: remaining
          },
          proofs: {
            records,
            summaryDocument: mockGenerateProofSummary(records)
          }
        });
      },
      continueCurrentCard: () =>
        set((state) => ({
          deck: {
            ...state.deck,
            activeTimeMode: state.deck.activeTimeMode === "paused" ? "idle" : state.deck.activeTimeMode
          }
        })),
      freezeCurrentDeck: () =>
        set((state) => {
          const activeDeck = state.deck.decks.find((deck) => deck.id === state.deck.activeDeckId);
          const currentCard = activeDeck?.cards.find((card) => card.id === state.deck.currentCardId);

          if (!activeDeck || activeDeck.deckStatus === "frozen" || activeDeck.deckStatus === "failed" || activeDeck.deckStatus === "completed") {
            return state;
          }

          const cards = activeDeck.cards.map((card) =>
            card.status === "completed" || card.status === "rewarded"
              ? card
              : {
                  ...card,
                  status: "frozen" as const,
                  damageEffect: "freeze" as const,
                  urgencyStage: "calm" as const,
                  burnLevel: 0 as const,
                  suggestedStartAt: card.suggestedStartAt ?? new Date().toISOString(),
                  cardBackNote: "整组任务已冻结在后台,后续卡片停止打卡。"
                }
          );
          const frozenIds = cards.filter((card) => card.status === "frozen").map((card) => card.id);
          const frozenCardIds = Array.from(new Set([...state.deck.frozenCardIds, ...frozenIds]));
          const updatedDeck: TaskDeck = {
            ...activeDeck,
            deckStatus: "frozen",
            cards,
            completedCards: cards.filter((card) => card.status === "completed" || card.status === "rewarded").length
          };

          // Register each freshly frozen card with the freeze-return agent.
          // Without these entries the agent has nothing to sweep, and the
          // promised "we'll remind you to come back" never fires.
          const nowIso = new Date().toISOString();
          const newFrozenEntries: FrozenTaskEntry[] = cards
            .filter((card) => card.status === "frozen" && !state.deck.frozenTasks.some((entry) => entry.card.id === card.id))
            .map((card) => buildFrozenTaskEntry(card, updatedDeck, nowIso));
          const frozenTasks = [...state.deck.frozenTasks, ...newFrozenEntries];

          const proofRecord: ProofRecord = {
            id: makeProofId(),
            deckId: activeDeck.id,
            goalTitle: activeDeck.coverTitle,
            source: state.inputs.sourceType,
            status: "frozen",
            ...getDeckProofProgress(updatedDeck, frozenIds.length),
            actualMinutes: currentCard ? getActualMinutes(currentCard) : getDeckActualMinutes(activeDeck.cards),
            timeStatus: "frozen-rescheduled",
            timeDamageEvents: [
              "右滑冻结整组任务,停止后续卡片打卡",
              newFrozenEntries.length > 0
                ? `已为 ${newFrozenEntries.length} 张卡安排回归提醒,最近一次将在 ${formatReturnLabel(newFrozenEntries[0].returnAfter)}`
                : "冻结任务已登记,等待回归窗口"
            ],
            lastDamageEffect: "freeze",
            lastAction: `冻结任务:${activeDeck.coverTitle}`,
            nextSuggestion:
              newFrozenEntries.length > 0
                ? `到点会主动提醒你回到这张卡(${formatReturnLabel(newFrozenEntries[0].returnAfter)})`
                : "任务已冻结在后台。需要恢复时可手动新建。",
            createdAt: nowIso
          };
          const records = [proofRecord, ...state.proofs.records];

          return {
            taskFlow: lockFlowFromCards(state.taskFlow, cards, "frozen"),
            deck: {
              ...state.deck,
              decks: replaceDeck(state.deck.decks, updatedDeck),
              currentCardId: null,
              frozenCardIds,
              frozenTasks,
              rescheduleQueue: Array.from(new Set([...state.deck.rescheduleQueue, activeDeck.id])),
              activeTimeMode: "idle"
            },
            proofs: {
              records,
              summaryDocument: mockGenerateProofSummary(records)
            }
          };
        }),
      freezeCurrentCard: () => {
        get().freezeCurrentDeck();
        const after = get();
        const activeDeck = after.deck.decks.find((d) => d.id === after.deck.activeDeckId);
        if (activeDeck) {
          fireWorkerTick(activeDeck, after.analysis, after.deck.frozenTasks);
        }
      },
      completeCurrentCard: (direction) => {
        set((state) => {
          const activeDeck = state.deck.decks.find((deck) => deck.id === state.deck.activeDeckId);
          const currentIndex = activeDeck?.cards.findIndex((card) => card.id === state.deck.currentCardId) ?? -1;
          const currentCard = activeDeck?.cards[currentIndex];

          if (!activeDeck || !currentCard || activeDeck.deckStatus === "frozen" || activeDeck.deckStatus === "failed" || activeDeck.deckStatus === "completed") {
            return state;
          }

          const actualMinutes = getActualMinutes(currentCard);
          const nextCardId = getNextCardId(activeDeck.cards, currentIndex);
          const completedCardIds = Array.from(new Set([...state.deck.completedCardIds, currentCard.id]));
          const wasBurning = state.deck.activeTimeMode === "burning" || currentCard.urgencyStage === "burning";
          const cards = activeDeck.cards.map((card) => {
            if (card.id === currentCard.id) {
              return {
                ...card,
                status: "completed" as const,
                elapsedSeconds: actualMinutes * 60,
                damageProgress: wasBurning ? 100 : card.damageProgress,
                urgencyStage: wasBurning ? "burning" as const : card.urgencyStage
              };
            }

            if (card.id === nextCardId) {
              return { ...card, status: "active" as const };
            }

            return card;
          });
          const completedCount = cards.filter((card) => card.status === "completed" || card.status === "rewarded").length;
          const allDone = completedCount === activeDeck.totalCards;
          const rewardCard: RewardCard | null = allDone
            ? {
                id: makeRewardId(),
                deckId: activeDeck.id,
                title: `${activeDeck.coverTitle} 已变成行动证据`,
                summary: `完成 ${completedCount} 张分解卡,实际投入约 ${cards.reduce((sum, card) => sum + Math.ceil(card.elapsedSeconds / 60), 0)} 分钟。`,
                actualMinutes: cards.reduce((sum, card) => sum + Math.ceil(card.elapsedSeconds / 60), 0),
                timePerformance: wasBurning ? "燃烧模式完成 1 张卡" : `比预计更稳地完成 ${completedCount} 张卡`,
                createdAt: new Date().toISOString()
              }
            : null;
          const updatedDeck: TaskDeck = {
            ...activeDeck,
            deckStatus: allDone ? "completed" : "active",
            cards,
            completedCards: completedCount
          };
          const proofRecord: ProofRecord = {
            id: makeProofId(),
            deckId: activeDeck.id,
            cardId: currentCard.id,
            goalTitle: activeDeck.coverTitle,
            source: state.inputs.sourceType,
            status: allDone ? "rewarded" : "completed",
            ...getDeckProofProgress(updatedDeck, state.deck.frozenCardIds.length),
            actualMinutes,
            timeStatus: wasBurning ? "burning-completed" : "on-time",
            timeDamageEvents: [
              `${direction === "left" ? "左滑" : direction === "right" ? "右滑" : "按钮"}完成卡片`,
              wasBurning ? `快速燃烧 ${actualMinutes} 分钟后完成` : `实际用时 ${actualMinutes} 分钟`
            ],
            lastDamageEffect: wasBurning ? "burn" : undefined,
            lastAction: allDone ? `奖励卡生成:${currentCard.title}` : `完成:${currentCard.title}`,
            nextSuggestion: allDone ? "查看 proof summary,并决定下一组 deck" : "进入下一张卡,保持单卡节奏",
            createdAt: new Date().toISOString()
          };
          const rewardProof: ProofRecord | null = rewardCard
            ? {
                id: makeProofId(),
                deckId: activeDeck.id,
                cardId: currentCard.id,
                goalTitle: activeDeck.coverTitle,
                source: state.inputs.sourceType,
                status: "rewarded",
                progress: 100,
                completedCards: completedCount,
                frozenCards: state.deck.frozenCardIds.length,
                actualMinutes: rewardCard.actualMinutes,
                timeStatus: wasBurning ? "burning-completed" : "on-time",
                timeDamageEvents: ["奖励卡生成", rewardCard.timePerformance],
                lastAction: rewardCard.title,
                nextSuggestion: "把结果写入 proof,稍后复盘最有效的小任务",
                createdAt: rewardCard.createdAt
              }
            : null;
          const records = [rewardProof, proofRecord, ...state.proofs.records].filter(Boolean) as ProofRecord[];

          return {
            taskFlow: updateFlowFromCards(state.taskFlow, cards),
            lastCompletion: {
              deckId: activeDeck.id,
              cardId: currentCard.id,
              proofId: proofRecord.id
            },
            activeOverlay: allDone ? { type: "completion-receipt" } : state.activeOverlay,
            deck: {
              ...state.deck,
              decks: replaceDeck(state.deck.decks, updatedDeck),
              currentCardId: allDone ? null : nextCardId,
              completedCardIds,
              rewardCards: rewardCard ? [rewardCard, ...state.deck.rewardCards] : state.deck.rewardCards,
              activeTimeMode: "idle"
            },
            proofs: {
              records,
              summaryDocument: mockGenerateProofSummary(records)
            }
          };
        });
        const after = get();
        const activeDeck = after.deck.decks.find((d) => d.id === after.deck.activeDeckId);
        if (activeDeck) {
          fireWorkerTick(activeDeck, after.analysis, after.deck.frozenTasks);
        }
      }
    }),
    {
      name: "next-card-mvp",
      version: 4,
      migrate: (persistedState) => {
        const persisted = persistedState as PersistedNextCardState;
        if (persisted?.deck && !Array.isArray((persisted.deck as DeckState).frozenTasks)) {
          // v3 → v4: backfill the freeze-return ledger introduced for Agent 2.
          // Existing decks have no entries; new freezes will populate it.
          return {
            ...persisted,
            deck: { ...persisted.deck, frozenTasks: [] }
          } as PersistedNextCardState;
        }
        return persisted;
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedNextCardState;
        const persistedDeck = persisted.deck
          ? {
              ...persisted.deck,
              frozenTasks: Array.isArray((persisted.deck as DeckState).frozenTasks)
                ? (persisted.deck as DeckState).frozenTasks
                : []
            }
          : currentState.deck;

        return {
          ...currentState,
          inputs: persisted.inputs ?? currentState.inputs,
          analysis: persisted.analysis ?? currentState.analysis,
          analysisStatus: persisted.analysisStatus ?? currentState.analysisStatus,
          plans: persisted.plans ?? currentState.plans,
          taskFlow: persisted.taskFlow ?? currentState.taskFlow,
          deck: persistedDeck,
          proofs: persisted.proofs ?? currentState.proofs,
          mode: "input",
          activeOverlay: null,
          deckPanelOpen: false,
          focusCardMode: true,
          activePlanCatalogId: undefined,
          lastCompletion: undefined,
          messages: [],
          isAiResponding: false,
          aiFallback: false,
          clarifyingQuestion: null,
          clarificationAnswer: null,
          turnCount: 0,
          thinkingSteps: [],
          revealedThinkingCount: 0
        };
      },
      partialize: (state) => ({
        inputs: state.inputs,
        analysis: state.analysis,
        analysisStatus: state.analysisStatus,
        plans: state.plans,
        taskFlow: state.taskFlow,
        deck: state.deck,
        proofs: state.proofs
      })
    }
  )
);
