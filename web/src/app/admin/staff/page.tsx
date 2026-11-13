import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { Alert, Card, PageHeader } from "@/components/ui";
import { deleteStaff, resetStaffPassword, updateKitchen, updateStaff } from "./actions";
import { KitchenForm, StaffRow, type StaffMember } from "./staff-forms";

export const metadata: Metadata = { title: "Staff" };

async function loadEmails(): Promise<Map<string, string>> {
  if (!env.supabaseSecretKey) return new Map();
  const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
  return new Map((data?.users ?? []).flatMap((u) => (u.email ? [[u.id, u.email] as const] : [])));
}

export default async function StaffPage() {
  const me = await requireRole(["admin"]);
  const supabase = await createClient();

  const [{ data: profiles }, { data: kitchens }, emails] = await Promise.all([
    supabase.from("staff_profiles").select("user_id, full_name, role, is_active, deleted_at, staff_kitchens(kitchen_id)").order("full_name"),
    supabase.from("kitchens").select("id, code, name, is_active").order("sort_order"),
    loadEmails(),
  ]);

  // Deleted staff (2026-10-24) keep their profile for old orders' "taken by"; they are listed apart.
  const deleted = (profiles ?? []).filter((p) => p.deleted_at);
  const members: StaffMember[] = (profiles ?? []).filter((p) => !p.deleted_at).map((p) => ({
    user_id: p.user_id,
    full_name: p.full_name,
    role: p.role,
    is_active: p.is_active,
    email: emails.get(p.user_id) ?? null,
    kitchen_ids: p.staff_kitchens.map((sk) => sk.kitchen_id),
  }));
  const chefsWithoutKitchen = members.filter((m) => m.is_active && m.role === "chef" && m.kitchen_ids.length === 0);
  const activeAdmins = members.filter((m) => m.role === "admin" && m.is_active).length;

  return (
    <>
      <PageHeader title="Staff" description="Individual logins for every admin, counter staff member and chef." />

      <div className="flex flex-col gap-6">
        {!env.supabaseSecretKey && (
          <Alert title="Staff logins are read-only">
            To reset passwords and delete logins, add <code className="font-mono">SUPABASE_SECRET_KEY</code> to{" "}
            <code className="font-mono">web/.env.local</code> (Supabase dashboard → Project Settings → API Keys) and restart the app.
          </Alert>
        )}
        {chefsWithoutKitchen.length > 0 && (
          <Alert tone="warn" title="Chefs without a kitchen">
            {chefsWithoutKitchen.map((c) => c.full_name).join(", ")} see no orders. Edit them and choose their kitchen.
          </Alert>
        )}

        <Card>
          <h2 className="mb-4 text-lg font-semibold">Staff ({members.length})</h2>
          <ul className="flex flex-col gap-3">
            {members.map((m) => (
              <StaffRow
                key={m.user_id}
                kitchens={kitchens ?? []}
                member={m}
                isSelf={m.user_id === me.userId}
                lastAdmin={m.role === "admin" && m.is_active && activeAdmins <= 1}
                saveAction={updateStaff.bind(null, m.user_id)}
                resetAction={resetStaffPassword.bind(null, m.user_id)}
                deleteAction={deleteStaff.bind(null, m.user_id)}
              />
            ))}
          </ul>
          {deleted.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted">Deleted staff ({deleted.length})</summary>
              <ul className="mt-2 flex flex-col gap-1 pl-4">
                {deleted.map((d) => (
                  <li key={d.user_id} className="text-muted">
                    {d.full_name} · deleted {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(d.deleted_at!))}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Kitchens</h2>
          <p className="mb-4 mt-1 text-sm text-muted">Rename them to match your bakery. Kitchen 1 makes custom orders and Kitchen 2 web orders; each chef works in one.</p>
          <div className="flex flex-col gap-3">
            {(kitchens ?? []).map((k) => (
              <KitchenForm key={k.id} kitchen={k} action={updateKitchen.bind(null, k.id)} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
