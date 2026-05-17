import type { FreezeReturnDecision, FrozenTaskEntry, QueueItem, TaskCard } from "@/lib/types";
import { calculatePriorityVector, createQueueAction } from "@/lib/server/priority-engine";

export function analyzeFrozenTaskReturn(input: {
  now: string;
  entry: FrozenTaskEntry;
  currentQueue: QueueItem[];
}): FreezeReturnDecision {
  const frozenItem = frozenEntryToQueueItem(input.entry);
  const priorityVector = calculatePriorityVector(frozenItem, input.now);
  const nowMs = new Date(input.now).getTime();
  const returnAfterMs = new Date(input.entry.returnAfter).getTime();

  if (nowMs < returnAfterMs) {
    return {
      action: createQueueAction({
        kind: "keep-waiting",
        targetId: input.entry.card.id,
        title: input.entry.card.title,
        priority: priorityVector.score,
        scheduledFor: input.entry.returnAfter,
        now: input.now,
        reason: "冻结任务还没到回归窗口。"
      }),
      reason: "returnAfter 未到，继续保留冻结上下文。",
      priorityVector
    };
  }

  const urgentCurrent = input.currentQueue
    .map((item) => ({ item, vector: calculatePriorityVector(item, input.now) }))
    .sort((left, right) => right.vector.score - left.vector.score)[0];

  if (urgentCurrent && urgentCurrent.vector.score >= priorityVector.score + 15 && urgentCurrent.vector.urgency >= 85) {
    return {
      action: createQueueAction({
        kind: "create-reminder",
        targetId: input.entry.card.id,
        title: input.entry.card.title,
        priority: priorityVector.score,
        scheduledFor: addMinutes(input.now, 30),
        now: input.now,
        reason: "当前队列有更急任务，冻结卡先保留上下文并创建稍后提醒。",
        // Push payload context so the user sees why a reminder is firing.
        // AGENTS.md expects reminders to convey state (frozen / burning) and
        // a gentle next action, not just the goal title.
        payload: {
          title: `稍后再处理：${input.entry.card.title}`,
          body: `「${input.entry.deckTitle}」里的冻结卡先放着，30 分钟后再看是否恢复。`
        }
      }),
      reason: `当前队列存在更急任务「${urgentCurrent.item.title}」，暂不覆盖发牌。`,
      priorityVector
    };
  }

  const deadlineMinutes = input.entry.card.deadlineAt
    ? Math.round((new Date(input.entry.card.deadlineAt).getTime() - nowMs) / 60_000)
    : null;
  const shouldSplit =
    input.entry.card.estimatedMinutes > input.entry.minReentryMinutes &&
    (deadlineMinutes === null || deadlineMinutes <= Math.max(45, input.entry.card.estimatedMinutes * 2));

  if (shouldSplit) {
    const restoredCard = makeRestoredCard(input.entry, input.now, true);

    return {
      action: createQueueAction({
        kind: "split-frozen-card",
        targetId: input.entry.card.id,
        title: restoredCard.title,
        priority: priorityVector.score,
        now: input.now,
        reason: "冻结卡过大或接近 deadline，拆成更小的回归卡。"
      }),
      restoredCard,
      reason: "原冻结任务需要先用小回归卡接回，避免直接恢复过重任务。",
      priorityVector
    };
  }

  const restoredCard = makeRestoredCard(input.entry, input.now, false);

  return {
    action: createQueueAction({
      kind: "return-frozen-card",
      targetId: input.entry.card.id,
      title: input.entry.card.title,
      priority: priorityVector.score,
      now: input.now,
      reason: "冻结任务到点，当前队列允许恢复原卡。"
    }),
    restoredCard,
    reason: "冻结回归窗口已到，恢复原卡到 active。",
    priorityVector
  };
}

function frozenEntryToQueueItem(entry: FrozenTaskEntry): QueueItem {
  return {
    id: entry.card.id,
    title: entry.card.title,
    kind: "card",
    status: "frozen",
    source: "text",
    createdAt: entry.frozenAt,
    estimatedMinutes: entry.card.estimatedMinutes,
    deadlineAt: entry.card.deadlineAt,
    suggestedStartAt: entry.returnAfter,
    urgencyStage: entry.card.urgencyStage,
    deckId: entry.card.deckId,
    cardId: entry.card.id,
    frozenAt: entry.frozenAt,
    returnAfter: entry.returnAfter,
    timeLocks: []
  };
}

function makeRestoredCard(entry: FrozenTaskEntry, now: string, split: boolean): TaskCard {
  const estimatedMinutes = split ? Math.max(3, Math.min(entry.minReentryMinutes, entry.card.estimatedMinutes)) : entry.card.estimatedMinutes;

  return {
    ...entry.card,
    id: entry.card.id,
    title: split ? `回归：${entry.card.title}` : entry.card.title,
    action: split ? `只恢复上下文并完成 ${estimatedMinutes} 分钟内的小动作。` : entry.card.action,
    estimatedMinutes,
    suggestedStartAt: now,
    startedAt: null,
    elapsedSeconds: 0,
    urgencyStage: split ? "warm" : entry.card.urgencyStage === "expired" ? "hot" : entry.card.urgencyStage,
    damageEffect: "none",
    damageProgress: 0,
    burnLevel: 0,
    status: "active",
    cardBackNote: split
      ? `由原冻结任务「${entry.card.title}」拆出；上下文：${entry.contextSnapshot.join(" / ")}`
      : `冻结上下文已恢复：${entry.contextSnapshot.join(" / ")}`
  };
}

function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
