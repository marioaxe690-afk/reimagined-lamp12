import type { BackendPorts } from "@/lib/server/backend-ports";
import type { QueueAction } from "@/lib/types";

export type ProviderDispatchResult = {
  actionId: string;
  targetId: string;
  provider: "notification" | "calendar";
  status: "scheduled" | "updated" | "created" | "skipped" | "failed";
  providerId?: string;
  filePath?: string;
  error?: string;
};

export async function dispatchProviderActions(
  actions: QueueAction[],
  ports: Pick<BackendPorts, "notifications" | "calendar">
): Promise<ProviderDispatchResult[]> {
  const results: ProviderDispatchResult[] = [];

  for (const action of actions) {
    // Actions that the planner flagged for human review must not silently
    // hit Web Push or the calendar provider. We surface them as `skipped`
    // so the caller (worker tick / dashboard) can show them in a review
    // queue instead of dispatching them on the user's behalf.
    if (action.requiresUserReview) {
      results.push({
        actionId: action.id,
        targetId: action.targetId,
        provider: action.kind === "create-calendar-event" || action.kind === "update-calendar-event" ? "calendar" : "notification",
        status: "skipped",
        error: "requires-user-review"
      });
      continue;
    }

    if (action.kind === "create-reminder" || action.kind === "update-reminder") {
      results.push(await dispatchNotification(action, ports));
      continue;
    }

    if (action.kind === "create-calendar-event" || action.kind === "update-calendar-event") {
      results.push(await dispatchCalendar(action, ports));
    }
  }

  return results;
}

async function dispatchNotification(action: QueueAction, ports: Pick<BackendPorts, "notifications">) {
  try {
    const result = await ports.notifications.createOrUpdate(action);
    return {
      actionId: action.id,
      targetId: action.targetId,
      provider: "notification" as const,
      status: result.status,
      providerId: result.providerId,
      error: result.error
    };
  } catch (error) {
    return {
      actionId: action.id,
      targetId: action.targetId,
      provider: "notification" as const,
      status: "failed" as const,
      error: error instanceof Error ? error.message : "Unknown notification provider error"
    };
  }
}

async function dispatchCalendar(action: QueueAction, ports: Pick<BackendPorts, "calendar">) {
  try {
    const result = await ports.calendar.createOrUpdate(action);
    return {
      actionId: action.id,
      targetId: action.targetId,
      provider: "calendar" as const,
      status: result.status,
      providerId: result.providerId,
      filePath: result.filePath,
      error: result.error
    };
  } catch (error) {
    return {
      actionId: action.id,
      targetId: action.targetId,
      provider: "calendar" as const,
      status: "failed" as const,
      error: error instanceof Error ? error.message : "Unknown calendar provider error"
    };
  }
}
