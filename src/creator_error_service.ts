import { createHash } from "node:crypto";
import { z } from "zod";
import { InfraiError, type CaptureError, type ErrorPayload } from "./infrai_errors.js";

export const creatorFailureSchema = z.object({
  creatorId: z.string().min(1),
  operation: z.enum(["digital_asset_delivery", "subscriber_update", "content_processing"]),
  assetId: z.string().min(1),
  error: z.object({
    name: z.string().min(1),
    message: z.string().min(1),
    stack: z.string().min(1).optional(),
  }),
}).strict();

export type CreatorFailure = z.infer<typeof creatorFailureSchema>;

export function toCapturePayload(input: CreatorFailure): ErrorPayload {
  const occurrence = `${input.creatorId}:${input.operation}:${input.assetId}:${input.error.name}:${input.error.message}`;
  return {
    title: `Creator workflow failed: ${input.operation}`,
    message: input.error.message,
    exception: input.error.stack ?? `${input.error.name}: ${input.error.message}`,
    level: "error",
    fingerprint: ["creator-course", input.operation],
    context: {
      creator_id: input.creatorId,
      asset_id: input.assetId,
      operation: input.operation,
    },
    service: "creator-commerce",
    idempotency_key: createHash("sha256").update(occurrence).digest("hex"),
  };
}

export async function recordCreatorFailure(input: CreatorFailure, capture: CaptureError) {
  const payload = toCapturePayload(input);
  const captured = await capture(payload);
  return {
    recorded: true as const,
    groupKey: payload.fingerprint.join("/"),
    eventId: captured.event_id ?? null,
    errorGroupId: captured.error_group_id ?? null,
  };
}

export function errorResponse(error: unknown): { status: number; body: unknown } {
  if (error instanceof SyntaxError) {
    return { status: 400, body: { ok: false, error: "Request body must be valid JSON" } };
  }
  if (error instanceof z.ZodError) {
    return { status: 400, body: { ok: false, error: "Invalid creator failure", issues: error.issues } };
  }
  if (error instanceof InfraiError) {
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    return { status, body: { ok: false, error: error.message, code: error.code } };
  }
  return { status: 500, body: { ok: false, error: "Could not record creator failure" } };
}
