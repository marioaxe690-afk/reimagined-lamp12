import { NextResponse } from "next/server";
import { backendPorts } from "@/lib/server/backend-services";
import { dispatchProviderActions } from "@/lib/server/provider-dispatch";
import type { BackendWorkerSnapshot } from "@/lib/types";

export const runtime = "nodejs";

type WorkerTickRequest = Partial<BackendWorkerSnapshot> & {
  // Opt-in flags. By default a client-supplied snapshot is a *preview*: we
  // run the planner against it but neither persist it nor dispatch real
  // notifications. This prevents any caller from overwriting the server's
  // queue truth or triggering arbitrary push notifications on its behalf.
  persist?: boolean;
  dispatch?: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as WorkerTickRequest | null;
  const now = body?.now ?? new Date().toISOString();
  const clientSuppliedSnapshot = Boolean(body?.queueItems);
  const snapshot: BackendWorkerSnapshot = clientSuppliedSnapshot
    ? {
        now,
        queueItems: body!.queueItems!,
        activeQueue: body!.activeQueue ?? [],
        timeLocks: body!.timeLocks ?? [],
        frozenTasks: body!.frozenTasks ?? [],
        hiddenGoals: body!.hiddenGoals ?? [],
        processedActionIds: body!.processedActionIds ?? []
      }
    : await backendPorts.queueRepository.readSnapshot(now);

  const result = await backendPorts.worker.tick(snapshot);

  // Dispatch provider actions only when the caller explicitly opts in. The
  // worker tick endpoint sits in front of Web Push and ICS providers, so a
  // silent default would let any POSTer trigger reminders for every active
  // subscription.
  const dispatchResults = body?.dispatch === true ? await dispatchProviderActions(result.actions, backendPorts) : [];

  // Persist only when the caller explicitly asked, *and* never overwrite the
  // server snapshot with one supplied by an unauthenticated client unless
  // `persist: true` was set. The previous unconditional writeSnapshot
  // overwrote frozenTasks/hiddenGoals/timeLocks every time the frontend
  // fired its observe-only tick.
  if (body?.persist === true) {
    await backendPorts.queueRepository.writeSnapshot(snapshot);
    await backendPorts.queueRepository.markActionsProcessed(result.actions);
  }

  return NextResponse.json({
    ...result,
    dispatchResults,
    persisted: body?.persist === true,
    dispatched: body?.dispatch === true
  });
}
