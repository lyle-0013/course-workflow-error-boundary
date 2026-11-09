import assert from "node:assert/strict";
import test from "node:test";
import { recordCreatorFailure, toCapturePayload } from "../src/creator_error_service.js";
import type { CaptureError } from "../src/infrai_errors.js";

test("groups the same course operation across creators while separating workflow stages", async () => {
  const seen: ReturnType<typeof toCapturePayload>[] = [];
  const capture: CaptureError = async (payload) => {
    seen.push(payload);
    return { event_id: `event-${seen.length}`, error_group_id: "group-delivery" };
  };
  const base = {
    operation: "digital_asset_delivery" as const,
    assetId: "lesson-pack",
    error: { name: "DeliveryError", message: "Handoff did not complete" },
  };

  const first = await recordCreatorFailure({ ...base, creatorId: "teacher-a" }, capture);
  await recordCreatorFailure({ ...base, creatorId: "teacher-b" }, capture);
  const processing = toCapturePayload({ ...base, creatorId: "teacher-a", operation: "content_processing" });

  assert.deepEqual(seen[0]?.fingerprint, ["creator-course", "digital_asset_delivery"]);
  assert.deepEqual(seen[1]?.fingerprint, seen[0]?.fingerprint);
  assert.notDeepEqual(processing.fingerprint, seen[0]?.fingerprint);
  assert.equal(first.groupKey, "creator-course/digital_asset_delivery");
  assert.notEqual(seen[0]?.idempotency_key, seen[1]?.idempotency_key);
});
