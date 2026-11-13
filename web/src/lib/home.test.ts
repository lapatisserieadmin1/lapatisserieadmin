import { test } from "node:test";
import assert from "node:assert/strict";
import { netCollected } from "./home.ts";

test("money collected: payments minus refunds", () => {
  assert.equal(netCollected([{ kind: "payment", amount_paise: 50000 }, { kind: "refund", amount_paise: 2000 }, { kind: "payment", amount_paise: 1000 }]), 49000);
  assert.equal(netCollected([]), 0);
});
