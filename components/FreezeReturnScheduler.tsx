"use client";

import { useEffect, useRef } from "react";
import type { FrozenTaskEntry, TaskDeck } from "@/lib/types";
import { useNextCardStore } from "@/store/useNextCardStore";

/**
 * Drives Agent 2's freeze-return reminder. Every time the store's
 * `frozenTasks` ledger changes we (re-)register a setTimeout per entry that:
 *   1. fires the in-app proof note via `triggerFreezeReturn`
 *   2. asks the worker tick endpoint to dispatch the matching push
 *
 * This is the bridge that finally makes the "we'll remind you to come back"
 * promise observable: without it the FrozenTaskEntry ledger filled up but
 * nothing ever read it on the client side.
 *
 * The component renders nothing.
 */
export function FreezeReturnScheduler() {
  const frozenTasks = useNextCardStore((state) => state.deck.frozenTasks);
  const decks = useNextCardStore((state) => state.deck.decks);
  const analysis = useNextCardStore((state) => state.analysis);
  const triggerFreezeReturn = useNextCardStore((state) => state.triggerFreezeReturn);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    const liveIds = new Set(frozenTasks.map((entry) => entry.id));

    // Cancel timers that no longer correspond to a pending entry — the user
    // may have manually resumed the deck, or completed it.
    for (const [entryId, handle] of timers.entries()) {
      if (!liveIds.has(entryId)) {
        clearTimeout(handle);
        timers.delete(entryId);
      }
    }

    const now = Date.now();
    for (const entry of frozenTasks) {
      if (timers.has(entry.id)) continue;

      const fireAt = new Date(entry.returnAfter).getTime();
      const delay = Math.max(0, fireAt - now);

      // setTimeout in browsers caps at ~24.85 days. For longer windows we
      // re-arm on next mount; the entry stays in the persisted ledger so it
      // is recovered when the user returns to the app.
      const MAX_DELAY = 2_147_000_000;
      if (delay > MAX_DELAY) continue;

      const handle = setTimeout(() => {
        // Snapshot the latest deck/analysis at fire time so the dispatch
        // request reflects whatever the user has done since freezing.
        const state = useNextCardStore.getState();
        const stillPending = state.deck.frozenTasks.find((item) => item.id === entry.id);
        if (!stillPending) {
          timers.delete(entry.id);
          return;
        }

        const matchingDeck =
          state.deck.decks.find((d) => d.id === stillPending.card.deckId) ??
          state.deck.decks.find((d) => d.coverTitle === stillPending.deckTitle);

        triggerFreezeReturn(entry.id);

        // Best-effort: ask the server to dispatch the reminder. If push is
        // not configured the worker route returns a `skipped` result and
        // the in-app proof note (already written above) is the only signal,
        // matching the alignment "前端定时器（最小可行）".
        if (matchingDeck) {
          fireFreezeDispatch(matchingDeck, state.deck.frozenTasks.filter((item) => item.id !== entry.id), analysis);
        }

        timers.delete(entry.id);
      }, delay);

      timers.set(entry.id, handle);
    }

    return () => {
      // No-op on unmount — we *want* the timers to live across renders so we
      // don't reset them on every store change. The cleanup happens above
      // (entries that were resolved/cancelled) and on full app teardown the
      // tab is closing anyway.
    };
  }, [frozenTasks, analysis, decks, triggerFreezeReturn]);

  return null;
}

function fireFreezeDispatch(deck: TaskDeck, remainingFrozen: FrozenTaskEntry[], analysis: ReturnType<typeof useNextCardStore.getState>["analysis"]) {
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
      frozenTasks: remainingFrozen,
      hiddenGoals: [],
      processedActionIds: [],
      // Opt in to dispatch — this is exactly the moment the freeze-return
      // agent should surface the reminder. Web Push will fire if a
      // subscription exists; otherwise the dispatcher returns `skipped`.
      dispatch: true
    })
  }).catch(() => {
    // Failure here is non-fatal: the in-app proof note has already been
    // written, so the user still sees the reminder when they next open the
    // app.
  });
}
