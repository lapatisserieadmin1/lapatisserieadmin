"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Alert, Badge, Button, Checkbox, Field, Input, Select } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import { kitchenListLabel } from "@/lib/orders";

type SaveAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Kitchen = { id: string; code: string; name: string; is_active: boolean };
export type StaffMember = {
  user_id: string;
  full_name: string;
  role: "admin" | "counter" | "chef";
  is_active: boolean;
  email: string | null;
  kitchen_ids: string[];
};

const roleLabels = { admin: "Admin", counter: "Counter staff", chef: "Chef" };

export function KitchenForm({ kitchen, action }: { kitchen: Kitchen; action: SaveAction }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-line p-4">
      <div className="min-w-48 flex-1">
        <label htmlFor={`kitchen-${kitchen.id}`} className="mb-1 block text-xs font-medium text-muted">
          {kitchen.code} name
        </label>
        <Input id={`kitchen-${kitchen.id}`} name="name" defaultValue={kitchen.name} required maxLength={60} />
        {state.fieldErrors?.name && <p className="mt-1 text-xs text-danger">{state.fieldErrors.name}</p>}
      </div>
      <div className="pb-2">
        <Checkbox name="is_active" label="Active" defaultChecked={kitchen.is_active} />
      </div>
      <SubmitButton variant="secondary">Save</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

// Kitchens show only for chefs: they decide which orders the chef sees.
function RoleAndKitchens({
  kitchens,
  defaultRole,
  defaultKitchenIds,
  errors,
  prefix,
}: {
  kitchens: Kitchen[];
  defaultRole: StaffMember["role"];
  defaultKitchenIds: string[];
  errors: Record<string, string>;
  prefix: string;
}) {
  const [role, setRole] = useState(defaultRole);
  return (
    <>
      <Field label="Role" htmlFor={`${prefix}-role`} error={errors.role}>
        <Select id={`${prefix}-role`} name="role" value={role} onChange={(e) => setRole(e.target.value as StaffMember["role"])}>
          <option value="counter">Counter staff</option>
          <option value="chef">Chef (kitchen screen only, no amounts)</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>
      {role === "chef" && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Kitchen</legend>
          <div className="flex flex-wrap gap-4">
            {kitchens.map((k) => (
              <label key={k.id} className="flex items-start gap-2.5 text-sm">
                <input
                  type="radio"
                  name="kitchen_ids"
                  value={k.id}
                  defaultChecked={defaultKitchenIds[0] === k.id}
                  className="mt-0.5 size-4 accent-brand"
                />
                <span>
                  <span className="font-medium">{k.name}{k.is_active ? "" : " (inactive)"}</span>
                  <span className="block text-xs text-muted">{kitchenListLabel(k.code)}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.kitchen_ids ? (
            <p className="text-xs text-danger">{errors.kitchen_ids}</p>
          ) : (
            <p className="text-xs text-muted">The chef sees only this kitchen&apos;s orders, never prices.</p>
          )}
        </fieldset>
      )}
    </>
  );
}

// "Delete" with a confirmation dialog. Not shown for yourself; the last active admin cannot be deleted.
function DeleteStaff({ member, lastAdmin, action }: { member: StaffMember; lastAdmin: boolean; action: () => Promise<ActionState> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>({});

  return (
    <>
      <Button
        variant="danger"
        onClick={() => {
          setState({});
          dialog.current?.showModal();
        }}
        disabled={lastAdmin}
        title={lastAdmin ? "At least one active admin is required." : undefined}
      >
        Delete
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`del-${member.user_id}`}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-ink/30"
      >
        <h3 id={`del-${member.user_id}`} className="font-display text-xl font-semibold">Delete {member.full_name}?</h3>
        <p className="mt-2 text-sm text-muted">
          Their login stops working at once and they are signed out everywhere. Orders they took keep their name.
          This cannot be undone from here.
        </p>
        {state.message && !state.ok && <div className="mt-3"><Alert tone="danger">{state.message}</Alert></div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => dialog.current?.close()} disabled={pending} autoFocus>Cancel</Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await action();
                setState(r);
                if (r.ok) dialog.current?.close();
              })
            }
          >
            {pending ? "Deleting…" : "Delete staff member"}
          </Button>
        </div>
      </dialog>
    </>
  );
}

export function StaffRow({
  kitchens,
  member,
  isSelf,
  lastAdmin,
  saveAction,
  resetAction,
  deleteAction,
}: {
  kitchens: Kitchen[];
  member: StaffMember;
  isSelf: boolean;
  lastAdmin: boolean;
  saveAction: SaveAction;
  resetAction: SaveAction;
  deleteAction: () => Promise<ActionState>;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "password">("view");
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await saveAction(prev, formData);
    if (result.ok) setMode("view");
    return result;
  }, {});
  const [resetState, resetFormAction] = useActionState(resetAction, {});
  const err = state.fieldErrors ?? {};
  const kitchenNames = kitchens.filter((k) => member.kitchen_ids.includes(k.id)).map((k) => k.name);

  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{member.full_name}</span>
            {isSelf && <Badge tone="brand">You</Badge>}
            <Badge>{roleLabels[member.role]}</Badge>
            {!member.is_active && <Badge tone="danger">Disabled</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {member.email ?? "Email hidden (secret key not set)"}
            {member.role === "chef" && ` · ${kitchenNames.length ? kitchenNames.join(", ") : "No kitchen ticked"}`}
          </p>
        </div>
        {mode === "view" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setMode("edit")}>Edit</Button>
            <Button variant="ghost" onClick={() => setMode("password")}>Reset password</Button>
            {!isSelf && <DeleteStaff member={member} lastAdmin={lastAdmin} action={deleteAction} />}
          </div>
        )}
      </div>
      {mode === "view" && state.ok && state.message && <p className="mt-2 text-sm text-ok">{state.message}</p>}

      {mode === "edit" && (
        <form action={formAction} className="mt-4 border-t border-line pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Full name" htmlFor={`staff-${member.user_id}-name`} error={err.full_name}>
              <Input id={`staff-${member.user_id}-name`} name="full_name" defaultValue={member.full_name} required />
            </Field>
            <RoleAndKitchens
              kitchens={kitchens}
              defaultRole={member.role}
              defaultKitchenIds={member.kitchen_ids}
              errors={err}
              prefix={`staff-${member.user_id}`}
            />
            <div className="md:col-span-2">
              <Checkbox
                name="is_active"
                label="Active"
                hint="Untick to block this person immediately. Their history is kept."
                defaultChecked={member.is_active}
                disabled={isSelf}
              />
              {isSelf && <input type="hidden" name="is_active" value="on" />}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SubmitButton>Save</SubmitButton>
            <Button type="button" variant="secondary" onClick={() => setMode("view")}>Cancel</Button>
            <FormMessage state={state} />
          </div>
        </form>
      )}

      {mode === "password" && (
        <form action={resetFormAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <div className="min-w-60">
            <label htmlFor={`pw-${member.user_id}`} className="mb-1 block text-sm font-medium">New password</label>
            <Input id={`pw-${member.user_id}`} name="password" type="password" minLength={10} required autoComplete="new-password" />
          </div>
          <SubmitButton pendingText="Resetting…">Set password</SubmitButton>
          <Button type="button" variant="secondary" onClick={() => setMode("view")}>Close</Button>
          <FormMessage state={resetState} />
        </form>
      )}
    </li>
  );
}
