"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rpcError, type RpcFailure } from "@/lib/orders";

type Result = { ok: true } | ({ ok?: false } & RpcFailure);

const blockSchema = z.object({
  customerId: z.uuid(),
  blocked: z.boolean(),
  reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(300),
});

export async function setCustomerBlockedAction(input: z.input<typeof blockSchema>): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the reason." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_blocked", {
    p_customer_id: parsed.data.customerId,
    p_blocked: parsed.data.blocked,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  revalidatePath("/admin/customers", "layout");
  revalidatePath("/admin/orders", "layout");
  return { ok: true };
}
