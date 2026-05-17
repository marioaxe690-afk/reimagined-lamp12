export type SourceType = "text" | "attachment" | "image" | "mixed";
export type UrgencyStage = "calm" | "warm" | "hot" | "burning" | "expired";
export type DamageEffect = "none" | "burn" | "freeze" | "crack" | "weathering";
export type AnalysisStatus = "idle" | "thinking" | "asking" | "generating" | "ready";
export type ChatRole = "user" | "ai";
export type AIPhase = "thinking" | "asking" | "generating" | "ready";
export type AgentId =
  | "balanced-coach"
  | "deadline-guardian"
  | "micro-splitter"
  | "sprint-driver"
  | "gentle-recovery"
  | "meaning-coach";

export type BehaviorVector = {
  expectancy: number;
  taskValue: number;
  procrastination: number;
  timePressure: number;
  reasons: string[];
};

export type AgentPolicy = {
  strictness: number;
  decomposition: number;
  pushFrequency: number;
  burnSensitivity: number;
  freezeTolerance: number;
  rewardEmphasis: number;
  cardMinuteRange: [number, number];
  tone: "gentle" | "balanced" | "direct" | "urgent";
};

export type AgentProfile = {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  policy: AgentPolicy;
};

export type AgentDecision = {
  selectedAgentId: AgentId;
  confidence: number;
  reason: string;
};

export type ThinkingStep = {
  id: string;
  role: ChatRole;
  text: string;
  tone?: "understanding" | "time" | "uncertainty" | "confirmation";
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  tone?: "understanding" | "time" | "uncertainty" | "confirmation" | "reply";
  pending?: boolean;
  createdAt: string;
};

export type ClarificationOption = {
  id: string;
  label: string;
  effect: string;
};

export type ClarifyingQuestion = {
  id: string;
  question: string;
  options: ClarificationOption[];
  defaultOptionId: string;
};

export type ClarificationAnswer = {
  questionId: string;
  optionId: string;
  label: string;
  effect: string;
};

export type UploadedAttachment = {
  id: string;
  name: string;
  kind: "notice" | "document" | "unknown";
  /**
   * Parsed/summarized text content for this attachment.
   *
   * Historical name kept for backwards compatibility — it is **not** mock data.
   * After /api/backend/import/review processes the upload, this holds the
   * real parsed summary (top-level cards, deal-now hints, user review prompt).
   * During upload (before the request resolves) it briefly contains a
   * "正在解析…" placeholder.
   */
  mockedText: string;
  size?: number;
  mimeType?: string;
};

export type UploadedImage = {
  id: string;
  name: string;
  /**
   * Parsed/summarized text content for this image.
   *
   * Historical name kept for backwards compatibility — it is **not** mock data.
   * After /api/backend/import/review processes the image (or returns a 503
   * with a friendly downgrade message), this holds the real text.
   */
  parsedTimetable: string;
  size?: number;
  mimeType?: string;
};

export type InputsState = {
  text: string;
  attachments: UploadedAttachment[];
  imageSchedule: UploadedImage | null;
  parsedText: string;
  sourceType: SourceType;
};

export type AnalysisResult = {
  sourceType: SourceType;
  goalUnderstanding: string;
  constraints: string[];
  stages: string[];
  timeStrategy: string[];
  deadlineLabel: string;
  availableWindow: string;
  suggestedStart: string;
  behaviorVector: BehaviorVector;
  agentDecision: AgentDecision;
};

export type PlanOption = {
  id: "plan-1" | "plan-2" | "plan-3";
  name: string;
  style: "urgent" | "balanced" | "gentle";
  summary: string;
  estimatedTime: string;
  detailLevel: "high" | "medium" | "low";
  steps: string[];
  agentId: AgentId;
  agentName: string;
  agentPolicy: AgentPolicy;
};

export type AIReplyPayload = {
  reply: string;
  next_phase: AIPhase;
  question?: ClarifyingQuestion | null;
  plans?: PlanOption[] | null;
  analysis_patch?: Partial<AnalysisResult> | null;
};

export type PlansState = {
  goalUnderstanding: string;
  constraints: string[];
  timeStrategy: string[];
  options: PlanOption[];
  selectedPlanId: string | null;
  regenerateCount: number;
};

export type TaskFlowNode = {
  id: string;
  title: string;
  status: "not-started" | "active" | "completed" | "frozen" | "failed" | "rewarded" | "attention";
  progress: number;
  timeLabel: string;
  urgencyStage: UrgencyStage;
};

export type TaskFlowState = {
  title: string;
  nodes: TaskFlowNode[];
  edges: { from: string; to: string }[];
  overallProgress: number;
};

export type TaskDeck = {
  id: string;
  coverTitle: string;
  coverIcon: string;
  agentId: AgentId;
  agentName: string;
  deckStatus: "new" | "active" | "frozen" | "failed" | "completed" | "needs-review";
  cards: TaskCard[];
  totalCards: number;
  completedCards: number;
};

export type TaskCard = {
  id: string;
  deckId: string;
  agentId: AgentId;
  agentName: string;
  flowNodeId: string;
  title: string;
  action: string;
  estimatedMinutes: number;
  deadlineAt: string | null;
  suggestedStartAt: string | null;
  startedAt: string | null;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  urgencyStage: UrgencyStage;
  damageEffect: DamageEffect;
  damageProgress: number;
  burnLevel: 0 | 1 | 2 | 3;
  status: "queued" | "active" | "completed" | "frozen" | "rewarded" | "needs-review";
  encouragement: string;
  cardBackNote: string;
};

export type RewardCard = {
  id: string;
  deckId: string;
  title: string;
  summary: string;
  actualMinutes: number;
  timePerformance: string;
  createdAt: string;
};

export type DeckState = {
  decks: TaskDeck[];
  activeDeckId: string | null;
  currentCardId: string | null;
  completedCardIds: string[];
  frozenCardIds: string[];
  rewardCards: RewardCard[];
  rescheduleQueue: string[];
  /**
   * Frozen-task ledger: every entry represents one card the user chose to
   * freeze and the time at which the freeze-return agent should consider
   * surfacing it again. Persisted alongside the deck so reminders survive
   * reloads.
   */
  frozenTasks: FrozenTaskEntry[];
  activeTimeMode: "idle" | "timing" | "burning" | "paused";
};

export type ProofRecord = {
  id: string;
  deckId?: string;
  cardId?: string;
  goalTitle: string;
  source: SourceType;
  agentId?: AgentId;
  agentName?: string;
  behaviorSnapshot?: BehaviorVector;
  status: "completed" | "in-progress" | "frozen" | "failed" | "rewarded" | "needs-review";
  progress: number;
  completedCards: number;
  frozenCards: number;
  actualMinutes: number;
  timeStatus: "on-time" | "burning-completed" | "frozen-rescheduled" | "expired";
  timeDamageEvents: string[];
  lastDamageEffect?: Exclude<DamageEffect, "none">;
  lastAction: string;
  nextSuggestion: string;
  createdAt: string;
};

export type ProofsState = {
  records: ProofRecord[];
  summaryDocument: string;
};

export type LastCompletion = {
  deckId: string;
  cardId: string;
  proofId: string;
};

export type OverlayType =
  | "guide"
  | "task-node-detail"
  | "plan-catalog-detail"
  | "deck-stack-detail"
  | "deck-card-detail"
  | "evidence-review"
  | "reward-review"
  | "freeze-review"
  | "burn-review"
  | "burn-failed-review"
  | "frozen-todo-review"
  | "proof-excel-review"
  | "completion-receipt"
  | "summary-review"
  | "proof-record-review";

export type ActiveOverlay = {
  type: OverlayType;
  id?: string;
} | null;

export type Mode = "input" | "deck" | "proof";

export type TimeLockStrength = "hard" | "soft" | "advisory";

export type TimeLockKind =
  | "notebook-fixed"
  | "user-fixed"
  | "deadline"
  | "calendar-busy"
  | "reminder-fixed";

export type QueueTargetType = "card" | "deck" | "event" | "hidden-goal" | "reminder" | "calendar-event";

export type TimeLock = {
  id: string;
  targetId: string;
  targetType: QueueTargetType;
  kind: TimeLockKind;
  strength: TimeLockStrength;
  startsAt?: string;
  endsAt?: string;
  lockedAt: string;
  reason: string;
  canAgentMove: boolean;
  canAgentSuggest: boolean;
};

export type QueueItemKind = "card" | "deck" | "event" | "hidden-goal" | "reminder" | "calendar-event";

export type QueueItemStatus =
  | "queued"
  | "active"
  | "frozen"
  | "hidden"
  | "completed"
  | "needs-review";

export type QueueSyncState = "none" | "wanted" | "synced" | "failed";

export type QueueItem = {
  id: string;
  title: string;
  kind: QueueItemKind;
  status: QueueItemStatus;
  source: SourceType;
  createdAt: string;
  estimatedMinutes: number;
  deadlineAt?: string | null;
  suggestedStartAt?: string | null;
  urgencyStage: UrgencyStage;
  position?: number;
  deckId?: string;
  cardId?: string;
  hidden?: boolean;
  calendarSync?: QueueSyncState;
  reminderSync?: QueueSyncState;
  frozenAt?: string | null;
  returnAfter?: string | null;
  behaviorVector?: BehaviorVector;
  timeLocks: TimeLock[];
};

export type PriorityVector = {
  urgency: number;
  importance: number;
  deadlineRisk: number;
  effort: number;
  confidence: number;
  timePressure: number;
  procrastinationRisk: number;
  freezeAge: number;
  contextCost: number;
  userLockPenalty: number;
  score: number;
  reasons: string[];
};

export type QueueActionKind =
  | "insert-task"
  | "move-task"
  | "deal-card"
  | "reveal-hidden-goal"
  | "create-reminder"
  | "update-reminder"
  | "create-calendar-event"
  | "update-calendar-event"
  | "suggest-time-change"
  | "return-frozen-card"
  | "split-frozen-card"
  | "keep-waiting"
  | "no-op";

export type QueueAction = {
  id: string;
  kind: QueueActionKind;
  targetId: string;
  title: string;
  priority: number;
  position?: number;
  scheduledFor?: string;
  payload?: Record<string, unknown>;
  reason: string;
  confidence: number;
  requiresUserReview: boolean;
  respectsLocks: boolean;
  createdAt: string;
};

export type LockedConflict = {
  targetId: string;
  lockId: string;
  kind: TimeLockKind;
  reason: string;
  suggestedAction: "keep-fixed" | "ask-user" | "suggest-only";
};

export type SchedulePlannerInput = {
  now: string;
  items: QueueItem[];
  activeQueue: string[];
  timeLocks: TimeLock[];
  maxDealCards?: 1 | 2;
};

export type SchedulePlannerOutput = {
  generatedAt: string;
  priorityVectors: Record<string, PriorityVector>;
  orderedQueue: string[];
  actions: QueueAction[];
  lockedConflicts: LockedConflict[];
};

export type FrozenTaskEntry = {
  id: string;
  card: TaskCard;
  deckTitle: string;
  frozenAt: string;
  returnAfter: string;
  reason: string;
  minReentryMinutes: number;
  contextSnapshot: string[];
};

export type FreezeReturnDecision = {
  action: QueueAction;
  restoredCard?: TaskCard;
  reason: string;
  priorityVector: PriorityVector;
};

export type PlanModeMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type PlanModeOption = {
  id: string;
  label: string;
  kind: "build" | "supplement" | "default-build" | "review";
  description: string;
  planId?: PlanOption["id"];
};

export type PlanModeTurnResult = {
  status: "ready-to-build" | "needs-supplement" | "needs-review";
  shouldBuildNow: boolean;
  analysis: {
    goalUnderstanding: string;
    knownConstraints: string[];
    missingInformation: string[];
    timeJudgement: string;
    recommendedDealMode: "deal-first-card" | "deal-two-cards" | "review-before-deal";
  };
  options: PlanModeOption[];
  context: {
    messagesUsed: number;
    facts: string[];
  };
  assistantQuestion?: never;
};

export type ImportCoverageCheck = {
  kind: "timetable-line-count" | "deadline-count" | "reminder-count" | "conflict-scan" | "omission-scan";
  passed: boolean;
  detail: string;
};

export type ImportConflict = {
  kind: "same-time-conflict" | "duplicate-title" | "missing-deadline";
  timeLabel?: string;
  itemIds: string[];
  detail: string;
};

export type ImportedTopLevelCard = {
  id: string;
  title: string;
  sourceLine: string;
  timeLabel?: string;
  kind: "course" | "deadline" | "reminder" | "task";
  reviewStatus: "pending";
};

export type ImportReviewResult = {
  reviewRequired: boolean;
  topLevelCards: ImportedTopLevelCard[];
  dealNowCards: ImportedTopLevelCard[];
  hiddenBacklogCards: ImportedTopLevelCard[];
  coverageChecks: ImportCoverageCheck[];
  possibleOmissions: string[];
  conflicts: ImportConflict[];
  userReviewPrompt: string;
};

export type BackendWorkerSnapshot = {
  now: string;
  queueItems: QueueItem[];
  activeQueue: string[];
  timeLocks: TimeLock[];
  frozenTasks: FrozenTaskEntry[];
  hiddenGoals: QueueItem[];
  processedActionIds: string[];
};

export type BackendWorkerTickResult = {
  tickId: string;
  generatedAt: string;
  actions: QueueAction[];
  skippedActionIds: string[];
  schedule: SchedulePlannerOutput;
  freezeDecisions: FreezeReturnDecision[];
};
