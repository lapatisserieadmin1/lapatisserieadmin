"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import { addDateOverride, removeDateOverride, saveCategoryCaps, saveWeekdayWindows, type WindowRowInput } from "./capacity-actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // staff read the week from Monday

type Row = WindowRowInput & { key: string };
const newRow = (start = "09:00", end = "11:00"): Row => ({ key: crypto.randomUUID(), start, end, max: "" });

// Editable list of windows (start, end, optional limit).
function WindowRows({ rows, onChange, idPrefix }: { rows: Row[]; onChange: (rows: Row[]) => void; idPrefix: string }) {
  const update = (key: string, patch: Partial<Row>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && <p className="text-sm text-muted">No windows: any time within opening hours can be booked.</p>}
      {rows.map((r, i) => (
        <div key={r.key} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`${idPrefix}-start-${i}`}>Window {i + 1} starts</label>
          <Input id={`${idPrefix}-start-${i}`} type="time" value={r.start} onChange={(e) => update(r.key, { start: e.target.value })} className="w-32" />
          <span className="text-sm text-muted">to</span>
          <label className="sr-only" htmlFor={`${idPrefix}-end-${i}`}>Window {i + 1} ends</label>
          <Input id={`${idPrefix}-end-${i}`} type="time" value={r.end} onChange={(e) => update(r.key, { end: e.target.value })} className="w-32" />
          <label className="sr-only" htmlFor={`${idPrefix}-max-${i}`}>Window {i + 1} order limit</label>
          <Input id={`${idPrefix}-max-${i}`} inputMode="numeric" placeholder="No limit" value={r.max}
            onChange={(e) => update(r.key, { max: e.target.value.replace(/\D/g, "").slice(0, 4) })} className="w-28" />
          <span className="text-sm text-muted">orders</span>
          <Button type="button" variant="ghost" onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>Remove</Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="secondary"
          onClick={() => onChange([...rows, rows.length ? newRow(rows[rows.length - 1].end, rows[rows.length - 1].end) : newRow()])}>
          Add window
        </Button>
      </div>
    </div>
  );
}

export type WindowRecord = { weekday: number; starts_at: string; ends_at: string; max_orders: number | null };

export function WeekdayWindowsForm({ windows }: { windows: WindowRecord[] }) {
  // Built once; keys are only for React lists.
  const [byDay, setByDay] = useState(() => Object.fromEntries(
    WEEK_ORDER.map((d) => [
      d,
      windows
        .filter((w) => w.weekday === d)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((w) => ({ key: crypto.randomUUID(), start: w.starts_at.slice(0, 5), end: w.ends_at.slice(0, 5), max: w.max_orders === null ? "" : String(w.max_orders) })),
    ]),
  ) as Record<number, Row[]>);
  const [day, setDay] = useState(1);
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  function save(weekdays: number[]) {
    const rows = byDay[day].map(({ start: s, end, max }) => ({ start: s, end, max }));
    start(async () => {
      const result = await saveWeekdayWindows({ weekdays, windows: rows });
      setState(result);
      if (result.ok && weekdays.length > 1) setByDay(Object.fromEntries(WEEK_ORDER.map((d) => [d, byDay[day].map((r) => ({ ...r, key: crypto.randomUUID() }))])));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Weekday">
        {WEEK_ORDER.map((d) => (
          <Button key={d} type="button" role="tab" aria-selected={d === day} variant={d === day ? "primary" : "secondary"}
            onClick={() => { setDay(d); setState({}); }}>
            {DAYS[d].slice(0, 3)} ({byDay[d].length})
          </Button>
        ))}
      </div>
      <WindowRows idPrefix={`wd-${day}`} rows={byDay[day]} onChange={(rows) => setByDay({ ...byDay, [day]: rows })} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={pending} onClick={() => save([day])}>{pending ? "Saving…" : `Save for ${DAYS[day]}`}</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => save(WEEK_ORDER)}>Use these windows for every day</Button>
        <FormMessage state={state} />
      </div>
    </div>
  );
}

export function CategoryCapsForm({ categories, caps }: { categories: { id: string; name: string }[]; caps: Record<string, number> }) {
  const [state, action] = useActionState<ActionState, FormData>(saveCategoryCaps, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col divide-y divide-line">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 py-2">
            <label htmlFor={`cap_${c.id}`} className="text-sm font-medium">{c.name}</label>
            <input type="hidden" name="category_id" value={c.id} />
            <Input id={`cap_${c.id}`} name={`cap_${c.id}`} inputMode="numeric" placeholder="No cap" className="w-28"
              defaultValue={caps[c.id] === undefined ? "" : String(caps[c.id])} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <SubmitButton>Save caps</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function DateOverrideForm({ categories, minDate }: { categories: { id: string; name: string }[]; minDate: string }) {
  const [kind, setKind] = useState<"window" | "category">("window");
  const [onDate, setOnDate] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [categoryId, setCategoryId] = useState("");
  const [max, setMax] = useState("");
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = kind === "window"
        ? await addDateOverride({ kind, onDate, note, windows: rows.map(({ start: s, end, max: m }) => ({ start: s, end, max: m })) })
        : await addDateOverride({ kind, onDate, note, categoryId, max });
      setState(result);
      if (result.ok) { setNote(""); setMax(""); setRows([newRow()]); }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date" htmlFor="ov-date">
          <Input id="ov-date" type="date" min={minDate} value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="ov-note" className="min-w-56 flex-1">
          <Input id="ov-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. Diwali" />
        </Field>
      </div>
      <div className="flex gap-4" role="radiogroup" aria-label="Override type">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" className="accent-brand" checked={kind === "window"} onChange={() => setKind("window")} /> Replace the day&apos;s windows
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" className="accent-brand" checked={kind === "category"} onChange={() => setKind("category")} /> Change one category&apos;s cap
        </label>
      </div>
      {kind === "window" ? (
        <WindowRows idPrefix="ov" rows={rows} onChange={setRows} />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Category" htmlFor="ov-cat">
            <Select id="ov-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Max orders that day" htmlFor="ov-max" hint="0 stops orders for this category that day.">
            <Input id="ov-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, "").slice(0, 4))} className="w-28" />
          </Field>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="button" disabled={pending} onClick={submit}>{pending ? "Adding…" : "Add override"}</Button>
        <FormMessage state={state} />
      </div>
    </div>
  );
}

export function RemoveOverrideButton({ onDate, kind, id }: { onDate: string; kind: "window" | "category"; id?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" disabled={pending} onClick={() => start(() => removeDateOverride({ onDate, kind, id }))}>
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}
