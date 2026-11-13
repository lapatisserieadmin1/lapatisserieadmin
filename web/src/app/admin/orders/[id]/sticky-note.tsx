"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Checkbox, Textarea } from "@/components/ui";
import { setStickyNoteAction } from "../actions";

// The note pinned at the top of the order (2026-10-24), optionally added to WhatsApp messages.
export function StickyNote({ orderId, note, inWhatsApp }: { orderId: string; note: string | null; inWhatsApp: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note ?? "");
  const [include, setInclude] = useState(inWhatsApp);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(nextText: string, nextInclude: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await setStickyNoteAction({ orderId, note: nextText, inWhatsApp: nextInclude });
      if (!r.ok) {
        setError(r.message ?? "Could not save the note.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing && !note) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="self-start rounded-xl border border-dashed border-note-line bg-note/60 px-3 py-2 text-sm font-medium text-ink hover:bg-note"
      >
        + Add a sticky note
      </button>
    );
  }

  return (
    <section aria-label="Sticky note" className="rounded-2xl border border-note-line bg-note px-4 py-3 shadow-sm">
      {editing ? (
        <div className="flex flex-col gap-3">
          <Textarea aria-label="Sticky note" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <Checkbox label="Include in WhatsApp message" checked={include} onChange={(e) => setInclude(e.target.checked)} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => save(text, include)}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setText(note ?? "");
                setInclude(inWhatsApp);
                setEditing(false);
              }}
              className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-brand-soft"
            >
              Cancel
            </button>
            {note && (
              <button
                type="button"
                disabled={pending}
                onClick={() => save("", false)}
                className="ml-auto rounded-xl px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft"
              >
                Remove note
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gold">Sticky note</p>
            <p className="mt-1 whitespace-pre-line break-words">{note}</p>
            <p className="mt-1 text-xs text-muted">{inWhatsApp ? "Added to WhatsApp messages" : "Not added to WhatsApp messages"}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={inWhatsApp}
                disabled={pending}
                onChange={(e) => save(note ?? "", e.target.checked)}
                className="size-4 accent-brand"
              />
              Include in WhatsApp message
            </label>
            <button type="button" onClick={() => setEditing(true)} className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-brand-soft">
              Edit
            </button>
          </div>
        </div>
      )}
      {error && <div className="mt-2"><Alert tone="warn">{error}</Alert></div>}
    </section>
  );
}
