import type { BackendWorkerSnapshot, BackendWorkerTickResult, FreezeReturnDecision, QueueAction } from "@/lib/types";
import { applyAgentRuntimeGuard, buildAgentRuntimePlan } from "@/lib/server/agent-runtime";
import { runFreezeReturnSweep } from "@/lib/server/freeze-sweep";
import { createSchedulePlan } from "@/lib/server/schedule-planner";

export function runBackendWorkerTick(snapshot: BackendWorkerSnapshot): BackendWorkerTickResult {
  const schedule = createSchedulePlan({
    now: snapshot.now,
    items: [...snapshot.queueItems, ...snapshot.hiddenGoals],
    activeQueue: snapshot.activeQueue,
    timeLocks: snapshot.timeLocks,
    maxDealCards: 2
  });
  const freezeDecisions = runFreezeReturnSweep({
    now: snapshot.now,
    frozenTasks: snapshot.frozenTasks,
    currentQueue: snapshot.queueItems
  });
  const allActions = [...schedule.actions, ...freezeDecisions.map((decision) => decision.action)];
  const skippedActionIds: string[] = [];
  const filteredActions = allActions.filter((action) => {
    if (snapshot.processedActionIds.includes(action.id)) {
      skippedActionIds.push(action.id);
      return false;
    }

    return true;
  });

  // Apply the runtime plan: actions whose kind is not in the worker-tick
  // trigger's allowlist get auto-flagged as requiresUserReview so dispatch
  // (provider-dispatch) treats them as proposals, not silent push events.
  const runtimePlan = buildAgentRuntimePlan({
    trigger: "worker-tick",
    agentId: "balanced-coach",
    now: snapshot.now
  });
  const actions = applyAgentRuntimeGuard(filteredActions, runtimePlan);

  return {
    tickId: `worker-${snapshot.now.replaceAll(":", "-").replaceAll(".", "-").replace("Z", "")}`,
    generatedAt: snapshot.now,
    actions: dedupeActions(actions),
    skippedActionIds,
    schedule,
    freezeDecisions
  };
}

function dedupeActions(actions: QueueAction[]) {
  const seen = new Set<string>();

  return actions.filter((action) => {
    if (seen.has(action.id)) {
      return false;
    }

    seen.add(action.id);
    return true;
  });
}

export type { FreezeReturnDecision };
