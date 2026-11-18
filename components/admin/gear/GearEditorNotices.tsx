import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { isLocked, MESSAGES, unknownOutcomeDetail, type EditorState, type UnknownReason } from "./gearEditorState";

// The editor's conflict and error messaging. Everything that needs the user's attention is a role="alert" element (announced by assistive
// technology when it appears); recovery actions are real, labelled buttons reachable by keyboard. Informational results are NOT announced from
// here: the editor's persistent screen-reader live region (liveMessage) carries them, so the visible paragraph has no live-region role and is
// never announced twice.

type NoticeHandlers = {
  onKeepEditing: () => void;
  onLoadLatest: () => void;
  onRetry: () => void;
  onCheckLatest: () => void;
};

export function GearConflictNotice({ acknowledged, busy, onKeepEditing, onLoadLatest }: { acknowledged: boolean; busy: boolean } & Pick<NoticeHandlers, "onKeepEditing" | "onLoadLatest">) {
  const detailId = `${useId()}-conflict-detail`;   // unique per rendered notice, so two editors on one page never share an id
  return (
    <div role="alert" aria-describedby={detailId} data-notice="stale-conflict" className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
      <p className="font-medium">This item was changed by someone else.</p>
      <p id={detailId}>
        {acknowledged
          ? "Your edits are still here but have not been saved. Saving stays off until you load the latest version."
          : "The version you started from is out of date, so nothing was saved. Your edits are still here and have not been sent. Saving is turned off until you load the latest version."}
      </p>
      <div className="flex flex-wrap gap-2">
        {acknowledged ? null : <Button type="button" variant="outline" data-focus="conflict-primary" onClick={onKeepEditing} className="border-amber-500/40 bg-transparent text-amber-100">Keep editing</Button>}
        <Button type="button" variant="outline" data-focus="load-latest" onClick={onLoadLatest} disabled={busy} aria-describedby={detailId} className="border-amber-500/40 bg-transparent text-amber-100">Load latest version…</Button>
      </div>
    </div>
  );
}

export function GearUnknownOutcomeNotice({ busy, reason = "network", onRetry, onCheckLatest }: { busy: boolean; reason?: UnknownReason } & Pick<NoticeHandlers, "onRetry" | "onCheckLatest">) {
  const detailId = `${useId()}-unknown-detail`;
  return (
    <div role="alert" aria-describedby={detailId} data-notice="unknown-outcome" className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
      <p className="font-medium">We couldn&apos;t confirm whether your save was applied.</p>
      <p id={detailId}>{unknownOutcomeDetail(reason)}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" data-focus="retry" onClick={onRetry} disabled={busy} aria-describedby={detailId} className="border-amber-500/40 bg-transparent text-amber-100">Retry the same save</Button>
        <Button type="button" variant="outline" data-focus="check-latest" onClick={onCheckLatest} disabled={busy} aria-describedby={detailId} className="border-amber-500/40 bg-transparent text-amber-100">Check latest</Button>
      </div>
    </div>
  );
}

/** Everything the footer shows for the editor's current state. Rendered to static markup in tests. */
export function GearEditorNotices({ state, ...handlers }: { state: EditorState } & NoticeHandlers) {
  const busy = isLocked(state);
  return (
    <>
      {state.versionProblem ? <p role="alert" data-notice="version-problem" className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{MESSAGES.versionProblem}</p> : null}
      {state.status === "stale" ? <GearConflictNotice acknowledged={state.conflictAcknowledged} busy={busy} onKeepEditing={handlers.onKeepEditing} onLoadLatest={handlers.onLoadLatest} /> : null}
      {state.status === "unknown" ? <GearUnknownOutcomeNotice busy={busy} reason={state.unknown?.reason} onRetry={handlers.onRetry} onCheckLatest={handlers.onCheckLatest} /> : null}
      {state.message ? <p role="alert" data-notice="error" className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{state.message}</p> : null}
      {state.sideMessage ? <p role="alert" data-notice="side-error" className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{state.sideMessage}</p> : null}
      {state.info ? <p data-notice="info" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{state.info}</p> : null}
    </>
  );
}
