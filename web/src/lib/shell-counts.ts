import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { attentionCount } from "@/lib/shell";

export type ShellCounts = { pending: number; latePickups: number; reviews: number; attention: number };

// Badge numbers for the sidebar and the bell, once per request: orders awaiting confirmation, packed orders
// past their pickup time and, for admins (who approve them), reviews waiting. Counts only; row-level security
// applies (admin and counter staff).
export const getShellCounts = cache(async (isAdmin: boolean): Promise<ShellCounts> => {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const head = { count: "exact" as const, head: true };
  const [pending, late, reviews] = await Promise.all([
    supabase.from("orders").select("id", head).eq("status", "pending_confirmation"),
    supabase.from("orders").select("id", head).eq("status", "ready").lt("due_at", nowIso),
    isAdmin ? supabase.from("reviews").select("id", head).eq("status", "pending") : Promise.resolve({ count: 0 }),
  ]);
  const counts = { pending: pending.count ?? 0, latePickups: late.count ?? 0, reviews: reviews.count ?? 0 };
  return { ...counts, attention: attentionCount(counts) };
});
