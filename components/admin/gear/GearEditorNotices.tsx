import { Button } from "@/components/ui/Button";
import { isLocked, MESSAGES, type EditorState } from "./gearEditorState";

// The editor's conflict and error messaging. Everything that needs the user's attention is a role="alert" element (announced by assistive
// technology when it appears); recovery actions are real, labelled buttons reachable by keyboard.

type NoticeHandlers = {
  onKeepEditing: () => void;
  onLoadLatest: () => void;
  onRetry: () => void;
  onCheckLatest: () => void;
};

export function GearConflictNotice({ acknowledged, busy, onKeepEditing, onLoadLatest }: { acknowledged: boolean; busy: boolean } & Pick<NoticeHandlers, "onKeepEditing" | "onLoadLatest">) {
  return (
    <div role="alert" aria-describedby="gear-conflict-detail" data-notice="stale-conflict" className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
      <p className="font-medium">This item was changed by someone else.</p>
      <p id="gear-conflict-detail">
        {acknowledged
          ? "Your edits are still here but have not been saved. Saving stays off until you load the latest version."
          : "The version you started from is out of date, so nothing was saved. Your edits are still here and have not been sent. Saving is turned off until you load the latest version."}
      </p>
      <div className="flex flex-wrap gap-2">
        {acknowledged ? null : <Button type="button" variant="outline" onClick={onKeepEditing} className="border-amber-500/40 bg-transparent text-amber-100">Keep editing</Button>}
        <Button type="button" variant="outline" onClick={onLoadLatest} disabled={busy} aria-describedby="gear-conflict-detail" className="border-amber-500/40 bg-transparent text-amber-100">Load latest version…</Button>
      </div>
    </div>
  );
}

export function GearUnknownOutcomeNotice({ busy, onRetry, onCheckLatest }: { busy: boolean } & Pick<NoticeHandlers, "onRetry" | "onCheckLatest">) {
  return (
    <div role="alert" aria-describedby="gear-unknown-detail" data-notice="unknown-outcome" className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
      <p className="font-medium">We couldn&apos;t confirm whether your save was applied.</p>
      <p id="gear-unknown-detail">
        Your edits are kept. Retrying sends exactly the same request, so it can&apos;t overwrite newer changes: if the first attempt was applied, the retry is rejected as a conflict. You can also check the latest version on the server.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onRetry} disabled={busy} aria-describedby="gear-unknown-detail" className="border-amber-500/40 bg-transparent text-amber-100">Retry the same save</Button>
        <Button type="button" variant="outline" onClick={onCheckLatest} disabled={busy} aria-describedby="gear-unknown-detail" className="border-amber-500/40 bg-transparent text-amber-100">Check latest</Button>
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
      {state.status === "unknown" ? <GearUnknownOutcomeNotice busy={busy} onRetry={handlers.onRetry} onCheckLatest={handlers.onCheckLatest} /> : null}
      {state.message ? <p role="alert" data-notice="error" className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{state.message}</p> : null}
      {state.sideMessage ? <p role="alert" data-notice="side-error" className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{state.sideMessage}</p> : null}
      {state.info ? <p role="status" data-notice="info" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{state.info}</p> : null}
    </>
  );
}
