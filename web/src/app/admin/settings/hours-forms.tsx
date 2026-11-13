"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { Button, Checkbox, Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import type { Tables } from "@/lib/database.types";
import { addClosure, removeClosure, updateHours } from "./actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function HoursForm({ hours }: { hours: Tables<"business_hours">[] }) {
  const [state, action] = useActionState<ActionState, FormData>(updateHours, {});
  const byDay = new Map(hours.map((h) => [h.weekday, h]));
  // Show Monday first, as staff read the week.
  const order = [1, 2, 3, 4, 5, 6, 0];

  return (
    <form action={action}>
      <div className="flex flex-col divide-y divide-line">
        {order.map((d) => {
          const h = byDay.get(d);
          return (
            <div key={d} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="w-28 text-sm font-medium">{DAYS[d]}</span>
              <label className="sr-only" htmlFor={`opens_${d}`}>{DAYS[d]} opens</label>
              <Input id={`opens_${d}`} name={`opens_${d}`} type="time" defaultValue={h?.opens_at.slice(0, 5) ?? "09:00"} className="w-32" />
              <span className="text-sm text-muted">to</span>
              <label className="sr-only" htmlFor={`closes_${d}`}>{DAYS[d]} closes</label>
              <Input id={`closes_${d}`} name={`closes_${d}`} type="time" defaultValue={h?.closes_at.slice(0, 5) ?? "21:00"} className="w-32" />
              <Checkbox name={`closed_${d}`} label="Closed" defaultChecked={h?.is_closed ?? false} />
              {state.fieldErrors?.[`day_${d}`] && <span className="text-xs text-danger">{state.fieldErrors[`day_${d}`]}</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-4">
        <SubmitButton>Save hours</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function ClosureForm() {
  const [state, action] = useActionState<ActionState, FormData>(addClosure, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-3">
      <Field label="Date" htmlFor="closed_on" error={state.fieldErrors?.closed_on}>
        <Input id="closed_on" name="closed_on" type="date" required />
      </Field>
      <Field label="Reason" htmlFor="closure_reason" error={state.fieldErrors?.reason} className="min-w-56 flex-1">
        <Input id="closure_reason" name="reason" placeholder="e.g. Diwali" maxLength={120} required />
      </Field>
      <SubmitButton pendingText="Adding…">Add closure</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function RemoveClosureButton({ closedOn }: { closedOn: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" disabled={pending} onClick={() => start(() => removeClosure(closedOn))}>
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}
