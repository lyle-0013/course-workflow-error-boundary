import { createServer, type ServerResponse } from "node:http";
import { createInfraiErrors } from "./infrai_errors.js";
import { creatorFailureSchema, errorResponse, recordCreatorFailure } from "./creator_error_service.js";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function client() {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
  const infrai = createInfraiErrors({ apiKey });
  return infrai.errors.capture;
}

export function startCreatorErrorService(port = 3000) {
  const capture = client();
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/creator-errors") {
      send(response, 404, { ok: false, error: "Route not found" });
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = creatorFailureSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const result = await recordCreatorFailure(input, capture);
      send(response, 202, { ok: true, data: result });
    } catch (error) {
      const mapped = errorResponse(error);
      send(response, mapped.status, mapped.body);
    }
  });
  return server.listen(port, () => console.log(`Creator error service listening on http://localhost:${port}`));
}

async function runExample(): Promise<void> {
  const input = creatorFailureSchema.parse({
    creatorId: "teacher-42",
    operation: "digital_asset_delivery",
    assetId: "algebra-coursebook-v3",
    error: {
      name: "DeliveryError",
      message: "Coursebook handoff did not complete",
      stack: "DeliveryError: Coursebook handoff did not complete",
    },
  });
  console.log(await recordCreatorFailure(input, client()));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  if (process.argv.includes("--serve")) startCreatorErrorService();
  else await runExample();
}
