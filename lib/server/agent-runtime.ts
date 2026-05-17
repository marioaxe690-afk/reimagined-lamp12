/**
 * Agent 2 — runtime plan + skill registry.
 *
 * This module is the declarative spine of Agent 2's scheduling surface. It
 * enumerates skills (goal-plan / multimodal-import / coverage-review /
 * review-gate / priority-score / time-lock-guard / schedule-insert /
 * freeze-return / hidden-goal-reveal / reminder-calendar-sync / ...) and the
 * triggers (goal-submitted, worker-tick, freeze-return-due, urgency-threshold,
 * card-completed) that fan them out.
 *
 * `applyAgentRuntimeGuard` is the live binding consumed by backend-worker.ts:
 * it filters QueueAction kinds against the trigger's allowlist and flags
 * anything outside it as requiresUserReview, so `worker-tick` cannot, e.g.,
 * silently mint a reveal-hidden-goal action that bypasses the review-gate.
 */
import type { AgentId, QueueActionKind, SourceType } from "@/lib/types";

export type AgentRuntimeLayer = "mimo-backend" | "queue-orchestrator" | "behavior-profile" | "provider-dispatch";

export type AgentSkillId =
  | "goal-plan"
  | "multimodal-import"
  | "coverage-review"
  | "review-gate"
  | "priority-score"
  | "time-lock-guard"
  | "schedule-insert"
  | "freeze-return"
  | "hidden-goal-reveal"
  | "reminder-calendar-sync"
  | "micro-decompose"
  | "deadline-protect"
  | "burn-pressure"
  | "freeze-recovery"
  | "proof-writing"
  | "meaning-reframe";

export type AgentTriggerKind =
  | "goal-submitted"
  | "large-import-received"
  | "worker-tick"
  | "freeze-return-due"
  | "urgency-threshold"
  | "card-completed";

export type AgentSkillDefinition = {
  id: AgentSkillId;
  name: string;
  layer: AgentRuntimeLayer;
  purpose: string;
  canMutateQueue: boolean;
  requiresUserReview?: boolean;
  queueActions?: QueueActionKind[];
};

export type AgentLayerEdge = {
  from: AgentRuntimeLayer;
  to: AgentRuntimeLayer;
  handoff: string;
  rule: string;
};

export type AgentAutoTrigger = {
  kind: AgentTriggerKind;
  cadence?: "immediate" | "every-5-minutes" | "threshold";
  background: boolean;
  skills: AgentSkillId[];
  description: string;
};

export type AgentRuntimeProfile = {
  id: AgentId;
  primarySkills: AgentSkillId[];
  skillWeights: Partial<Record<AgentSkillId, number>>;
  autoTriggers: AgentTriggerKind[];
};

export type AgentRuntimePlanInput = {
  trigger: AgentTriggerKind;
  agentId: AgentId;
  sourceType?: SourceType;
  now?: string;
};

export type AgentRuntimePlan = {
  trigger: AgentAutoTrigger;
  agentId: AgentId;
  skillOrder: AgentSkillId[];
  queueActions: QueueActionKind[];
  guards: string[];
  requiresUserReview: boolean;
};

export const AGENT_SKILLS: Record<AgentSkillId, AgentSkillDefinition> = {
  "goal-plan": {
    id: "goal-plan",
    name: "目标 Plan Mode",
    layer: "mimo-backend",
    purpose: "把用户输入转成目标理解、缺口、时间判断和三个方案。",
    canMutateQueue: false
  },
  "multimodal-import": {
    id: "multimodal-import",
    name: "多模态导入解析",
    layer: "mimo-backend",
    purpose: "解析课程表、通知、图片时间表或混合输入，生成顶层牌候选。",
    canMutateQueue: false
  },
  "coverage-review": {
    id: "coverage-review",
    name: "覆盖检查",
    layer: "mimo-backend",
    purpose: "交叉检查课程、截止、提醒、重复和遗漏。",
    canMutateQueue: false,
    requiresUserReview: true
  },
  "review-gate": {
    id: "review-gate",
    name: "强制检阅门",
    layer: "queue-orchestrator",
    purpose: "大导入进入队列前，要求用户确认顶层牌清单。",
    canMutateQueue: false,
    requiresUserReview: true
  },
  "priority-score": {
    id: "priority-score",
    name: "轻重缓急评分",
    layer: "queue-orchestrator",
    purpose: "根据 deadline、重要性、压力、冻结年龄和上下文成本计算 PriorityVector。",
    canMutateQueue: false
  },
  "time-lock-guard": {
    id: "time-lock-guard",
    name: "硬时间锁保护",
    layer: "queue-orchestrator",
    purpose: "保护用户固定时间、记事本时间、日历 busy 和 deadline 锁。",
    canMutateQueue: false
  },
  "schedule-insert": {
    id: "schedule-insert",
    name: "队列插入和排序",
    layer: "queue-orchestrator",
    purpose: "产出 insert、move、deal、suggest 等 QueueAction。",
    canMutateQueue: true,
    queueActions: ["insert-task", "move-task", "deal-card", "suggest-time-change"]
  },
  "freeze-return": {
    id: "freeze-return",
    name: "冻结回归分析",
    layer: "queue-orchestrator",
    purpose: "到点后重新分析冻结卡是否恢复、拆小或继续等待。",
    canMutateQueue: true,
    queueActions: ["return-frozen-card", "split-frozen-card", "keep-waiting"]
  },
  "hidden-goal-reveal": {
    id: "hidden-goal-reveal",
    name: "隐藏目标揭示",
    layer: "queue-orchestrator",
    purpose: "隐藏未来任务到达合适窗口时，发出 reveal 动作而非静默插入。",
    canMutateQueue: true,
    requiresUserReview: true,
    queueActions: ["reveal-hidden-goal"]
  },
  "reminder-calendar-sync": {
    id: "reminder-calendar-sync",
    name: "提醒和日历同步",
    layer: "provider-dispatch",
    purpose: "把调度动作交给 Web Push 和 Calendar provider。",
    canMutateQueue: false,
    queueActions: ["create-reminder", "update-reminder", "create-calendar-event", "update-calendar-event"]
  },
  "micro-decompose": {
    id: "micro-decompose",
    name: "微动作拆牌",
    layer: "behavior-profile",
    purpose: "降低第一张牌的启动门槛，控制每张卡分钟数。",
    canMutateQueue: false
  },
  "deadline-protect": {
    id: "deadline-protect",
    name: "截止窗口保护",
    layer: "behavior-profile",
    purpose: "提高临界窗口下的直接性和提醒频率。",
    canMutateQueue: false
  },
  "burn-pressure": {
    id: "burn-pressure",
    name: "燃烧压力提示",
    layer: "behavior-profile",
    purpose: "把时间压力显示成燃烧状态，但不遮挡内容或羞辱用户。",
    canMutateQueue: false
  },
  "freeze-recovery": {
    id: "freeze-recovery",
    name: "冻结恢复语义",
    layer: "behavior-profile",
    purpose: "让冻结卡保留上下文，并以低压力方式回归。",
    canMutateQueue: false
  },
  "proof-writing": {
    id: "proof-writing",
    name: "证据写入",
    layer: "behavior-profile",
    purpose: "把完成、冻结、燃烧、奖励写成 proof 记录。",
    canMutateQueue: false
  },
  "meaning-reframe": {
    id: "meaning-reframe",
    name: "意义重构",
    layer: "behavior-profile",
    purpose: "任务价值感不足时，把行动结果转成可见证据和收益。",
    canMutateQueue: false
  }
};

export const AGENT_LAYER_EDGES: AgentLayerEdge[] = [
  {
    from: "mimo-backend",
    to: "queue-orchestrator",
    handoff: "PlanModeTurnResult | ImportReviewResult",
    rule: "Mimo 只产出结构化理解、候选顶层牌和 review 信息，不直接写队列。"
  },
  {
    from: "behavior-profile",
    to: "queue-orchestrator",
    handoff: "AgentPolicy + skillWeights",
    rule: "本地 profile 调整拆牌粒度、提醒强度、冻结容忍和 proof 语义。"
  },
  {
    from: "queue-orchestrator",
    to: "provider-dispatch",
    handoff: "QueueAction[]",
    rule: "只有编排层产出 QueueAction，provider 只执行提醒和日历同步。"
  }
];

export const AGENT_AUTO_TRIGGERS: AgentAutoTrigger[] = [
  {
    kind: "goal-submitted",
    cadence: "immediate",
    background: false,
    skills: ["goal-plan", "micro-decompose", "deadline-protect", "proof-writing"],
    description: "用户提交目标后立即分析，并生成第一轮结构化方案。"
  },
  {
    kind: "large-import-received",
    cadence: "immediate",
    background: false,
    skills: ["multimodal-import", "coverage-review", "review-gate", "hidden-goal-reveal"],
    description: "课程表、通知或图片时间表进入强制 review gate。"
  },
  {
    kind: "worker-tick",
    cadence: "every-5-minutes",
    background: true,
    skills: ["priority-score", "time-lock-guard", "schedule-insert", "hidden-goal-reveal", "reminder-calendar-sync"],
    description: "后台 worker 定时扫描队列、冻结项、隐藏目标、提醒和日历。"
  },
  {
    kind: "freeze-return-due",
    cadence: "threshold",
    background: true,
    skills: ["freeze-return", "priority-score", "time-lock-guard", "schedule-insert"],
    description: "冻结卡到达 returnAfter 后重新分析是否恢复、拆小或继续等待。"
  },
  {
    kind: "urgency-threshold",
    cadence: "threshold",
    background: true,
    skills: ["deadline-protect", "burn-pressure", "priority-score", "time-lock-guard", "reminder-calendar-sync"],
    description: "卡片进入 warm/hot/burning/expired 阶段时触发临界窗口处理。"
  },
  {
    kind: "card-completed",
    cadence: "immediate",
    background: false,
    skills: ["proof-writing", "priority-score", "schedule-insert"],
    description: "用户完成卡片后写 proof，并决定下一张牌是否需要发出。"
  }
];

const BASE_SKILL_WEIGHTS: Partial<Record<AgentSkillId, number>> = {
  "micro-decompose": 0.55,
  "deadline-protect": 0.5,
  "burn-pressure": 0.5,
  "freeze-recovery": 0.5,
  "proof-writing": 0.6,
  "meaning-reframe": 0.45
};

const AGENT_RUNTIME_PROFILES: Record<AgentId, AgentRuntimeProfile> = {
  "balanced-coach": {
    id: "balanced-coach",
    primarySkills: ["micro-decompose", "deadline-protect", "freeze-recovery", "proof-writing"],
    skillWeights: {
      ...BASE_SKILL_WEIGHTS,
      "micro-decompose": 0.6,
      "deadline-protect": 0.55,
      "freeze-recovery": 0.55,
      "proof-writing": 0.7
    },
    autoTriggers: ["goal-submitted", "worker-tick", "card-completed"]
  },
  "deadline-guardian": {
    id: "deadline-guardian",
    primarySkills: ["deadline-protect", "burn-pressure", "reminder-calendar-sync", "proof-writing"],
    skillWeights: {
      ...BASE_SKILL_WEIGHTS,
      "deadline-protect": 0.95,
      "burn-pressure": 0.9,
      "micro-decompose": 0.58,
      "freeze-recovery": 0.32,
      "proof-writing": 0.68
    },
    autoTriggers: ["goal-submitted", "worker-tick", "urgency-threshold", "card-completed"]
  },
  "micro-splitter": {
    id: "micro-splitter",
    primarySkills: ["micro-decompose", "review-gate", "proof-writing", "freeze-recovery"],
    skillWeights: {
      ...BASE_SKILL_WEIGHTS,
      "micro-decompose": 0.96,
      "deadline-protect": 0.46,
      "freeze-recovery": 0.74,
      "proof-writing": 0.7
    },
    autoTriggers: ["goal-submitted", "large-import-received", "card-completed"]
  },
  "sprint-driver": {
    id: "sprint-driver",
    primarySkills: ["deadline-protect", "micro-decompose", "burn-pressure", "proof-writing"],
    skillWeights: {
      ...BASE_SKILL_WEIGHTS,
      "deadline-protect": 0.86,
      "micro-decompose": 0.82,
      "burn-pressure": 0.82,
      "freeze-recovery": 0.42,
      "proof-writing": 0.78
    },
    autoTriggers: ["goal-submitted", "worker-tick", "urgency-threshold", "card-completed"]
  },
  "gentle-recovery": {
    id: "gentle-recovery",
    primarySkills: ["freeze-recovery", "micro-decompose", "proof-writing", "meaning-reframe"],
    skillWeights: {
      ...BASE_SKILL_WEIGHTS,
      "freeze-recovery": 0.96,
      "micro-decompose": 0.84,
      "deadline-protect": 0.28,
      "burn-pressure": 0.25,
      "proof-writing": 0.75
    },
    autoTriggers: ["goal-submitted", "freeze-return-due", "card-completed"]
  },
  "meaning-coach": {
    id: "meaning-coach",
    primarySkills: ["meaning-reframe", "proof-writing", "micro-decompose", "freeze-recovery"],
    skillWeights: {
      ...BASE_SKILL_WEIGHTS,
      "meaning-reframe": 0.92,
      "proof-writing": 0.9,
      "micro-decompose": 0.66,
      "freeze-recovery": 0.64
    },
    autoTriggers: ["goal-submitted", "card-completed"]
  }
};

export function getAgentRuntimeProfile(agentId: AgentId): AgentRuntimeProfile {
  return AGENT_RUNTIME_PROFILES[agentId] ?? AGENT_RUNTIME_PROFILES["balanced-coach"];
}

export function buildAgentRuntimePlan(input: AgentRuntimePlanInput): AgentRuntimePlan {
  const trigger = AGENT_AUTO_TRIGGERS.find((item) => item.kind === input.trigger) ?? AGENT_AUTO_TRIGGERS[0];
  const profile = getAgentRuntimeProfile(input.agentId);
  const skillOrder = orderSkillsForSafety(Array.from(new Set([...trigger.skills, ...profile.primarySkills])));
  const requiresUserReview =
    input.trigger === "large-import-received" ||
    skillOrder.some((skillId) => AGENT_SKILLS[skillId].requiresUserReview);

  return {
    trigger,
    agentId: input.agentId,
    skillOrder,
    queueActions: queueActionsForTrigger(input.trigger, input.sourceType),
    guards: buildRuntimeGuards(skillOrder),
    requiresUserReview
  };
}

function orderSkillsForSafety(skills: AgentSkillId[]): AgentSkillId[] {
  const preferredOrder: AgentSkillId[] = [
    "goal-plan",
    "multimodal-import",
    "coverage-review",
    "review-gate",
    "freeze-return",
    "priority-score",
    "time-lock-guard",
    "micro-decompose",
    "deadline-protect",
    "burn-pressure",
    "freeze-recovery",
    "meaning-reframe",
    "schedule-insert",
    "hidden-goal-reveal",
    "reminder-calendar-sync",
    "proof-writing"
  ];

  return preferredOrder.filter((skillId) => skills.includes(skillId));
}

function queueActionsForTrigger(trigger: AgentTriggerKind, sourceType?: SourceType): QueueActionKind[] {
  if (trigger === "large-import-received") {
    return sourceType === "image" || sourceType === "attachment" || sourceType === "mixed"
      ? ["reveal-hidden-goal", "deal-card"]
      : ["deal-card"];
  }

  if (trigger === "freeze-return-due") {
    return ["return-frozen-card", "split-frozen-card", "keep-waiting"];
  }

  if (trigger === "worker-tick") {
    return ["insert-task", "move-task", "deal-card", "create-reminder", "create-calendar-event"];
  }

  if (trigger === "urgency-threshold") {
    return ["create-reminder", "suggest-time-change", "deal-card"];
  }

  if (trigger === "card-completed") {
    return ["deal-card", "insert-task"];
  }

  return ["deal-card"];
}

function buildRuntimeGuards(skillOrder: AgentSkillId[]) {
  const guards = ["mimo-cannot-write-queue-directly", "queue-actions-are-auditable"];

  if (skillOrder.includes("time-lock-guard")) {
    guards.push("hard-time-locks-are-suggest-only");
  }

  if (skillOrder.includes("review-gate")) {
    guards.push("large-imports-require-user-review");
  }

  return guards;
}

/**
 * Apply the runtime plan's guards and allowed queue actions to a freshly
 * produced QueueAction[]. Anything outside the trigger's `queueActions`
 * allowlist gets flagged as requiresUserReview, matching the AGENT_AUTO_TRIGGERS
 * declaration: a `worker-tick` may produce reminders/calendar/insert/move/deal,
 * but a `card-completed` should not silently mint reminders.
 *
 * This is the binding that finally makes agent-runtime.ts a runtime instead of
 * a documentation-only artifact — schedule-planner / freeze-sweep / worker
 * call this on every batch of actions before dispatch.
 */
export function applyAgentRuntimeGuard<T extends { kind: import("@/lib/types").QueueActionKind; requiresUserReview: boolean }>(
  actions: T[],
  plan: AgentRuntimePlan
): T[] {
  const allowed = new Set(plan.queueActions);

  return actions.map((action) => {
    if (allowed.has(action.kind)) {
      return action;
    }

    return {
      ...action,
      requiresUserReview: true
    };
  });
}
