import { requireRole } from "@/lib/auth";
import { getShellCounts } from "@/lib/shell-counts";
import { navSections } from "@/lib/shell";
import { AdminShell } from "@/components/shell/admin-shell";

const roleLabel = { admin: "Admin", counter: "Counter staff", chef: "Chef" } as const;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const staff = await requireRole(["admin", "counter"]);
  const role = staff.role === "admin" ? "admin" : "counter";
  const counts = await getShellCounts(role === "admin");

  return (
    <AdminShell sections={navSections(role)} counts={counts} name={staff.fullName} roleLabel={roleLabel[staff.role]}>
      {children}
    </AdminShell>
  );
}
