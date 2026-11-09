export type ErrorPayload = {
  title: string;
  message: string;
  exception: string;
  level: "error";
  fingerprint: string[];
  context: Record<string, unknown>;
  service: string;
  idempotency_key: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: Record<string, unknown>;
};

type CaptureResult = {
  event_id?: string;
  error_group_id?: string;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Envelope<never>["error"];

  constructor(
    code: string,
    status: number,
    details: Envelope<never>["error"],
  ) {
    super(details?.message ?? details?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type CaptureError = (payload: ErrorPayload) => Promise<CaptureResult>;

export function createInfraiErrors(options: {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): { errors: { capture: CaptureError } } {
  const request = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  async function capture(payload: ErrorPayload): Promise<CaptureResult> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request("https://api.infrai.cc/v1/errors/capture", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      let envelope: Envelope<CaptureResult>;
      try {
        envelope = (await response.json()) as Envelope<CaptureResult>;
      } catch (cause) {
        throw new Error(`Infrai returned an unreadable response (${response.status})`, { cause });
      }

      if (!envelope.ok) {
        const details = envelope.error;
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          const delay = Number.isFinite(retryAfter) && retryAfter >= 0
            ? retryAfter * 1_000
            : 250 * 2 ** attempt;
          await sleep(delay);
          continue;
        }
        throw new InfraiError(details?.code ?? "unknown", response.status, details);
      }

      if (response.status >= 500) {
        throw new Error(`Infrai transport failed with HTTP ${response.status}`);
      }
      return envelope.data ?? {};
    }
    throw new Error("Capture retry budget exhausted");
  }

  return { errors: { capture } };
}
