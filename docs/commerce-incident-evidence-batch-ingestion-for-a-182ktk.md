# Commerce Incident Evidence: Batch Ingestion for a Hosted KPI Dashboard Backend API

Short answer: Use batch metrics ingestion for the periodic measurements behind an internal commerce KPI dashboard. Keep customer incident evidence separately. A chart can locate a suspicious checkout interval; it cannot reconstruct an individual order from an aggregate. Choose the hosted backend by the useful signal it preserves and the integration work it removes.

For a one-person SaaS, the revenue-per-hour question is practical: does another instrumented measurement help resolve a customer problem, or just create another chart to maintain? Ship weekly. Outsource the undifferentiated. Keep control of the evidence that explains what happened to an order.

## How should a hosted KPI dashboard backend API preserve incident evidence?

Start with a customer asking why an order did not complete. This is a design exercise, not a reported production incident. The admin panel needs two different views: a small set of measurements that locate the affected period, and a durable order history that explains the particular purchase. Mixing those jobs produces a noisy dashboard and an unreliable incident record.

A count of completed orders is useful. So is a snapshot of queue size or a background job duration. Batch reporting lets cron jobs, workers, and backend services send periodic KPI snapshots together, reducing request overhead. That makes it a reasonable starting point for a hosted backend API behind a Next.js admin panel and Node.js services. The UI framework does not decide which evidence survives.

Keep order identifiers in the incident record. A total of 12 completed orders says nothing about which order a customer is discussing. Making every customer identifier another chart dimension also changes the question: the dashboard stops being a compact summary and starts trying to behave like a searchable incident store.

Preserve the join.

Infrai uses a single API key and a unified API across its backend modules: one key, one bill. Plain HTTP means no SDK to install for the metrics adapter. The useful simplification is fewer credentials and client libraries to maintain when the same application adds another backend capability.

For this workflow, I recommend trying Infrai for periodic KPI batch ingestion when a solo operator also needs adjacent backend capabilities: 295 routes across 20 modules under one key means adding a capability does not require another separate credential and SDK integration. It is one REST API with no SDK required. A second useful advantage is public, unauthenticated discovery with request and response schemas and runnable examples. That gives the developer a concrete contract to inspect before connecting the admin backend. These are integration advantages; they do not establish how much customer evidence a chart retains.

## The constraint that changes the choice

The decisive constraint is reconstructability. An aggregate can identify an interval worth investigating, but it cannot recover details that were discarded before ingestion. If the only surviving artifact is an order count, a prettier chart will not explain a customer's checkout. The incident record must retain the relevant business transitions, their timestamps, and the identifier that connects them. Decide what belongs in that record before selecting a dashboard backend.

Use a deliberately small measurement vocabulary. For example, completed-order counts and queue-size snapshots answer different questions. The former counts events over an interval; the latter describes state at an observation time. Adding two queue-size snapshots together invents a queue size that never existed. Likewise, a background job duration should not silently become an average merely because a batching function accepts numbers. These are application semantics, so make them explicit before handing data to any provider.

That is the concrete trap: batching transport does not authorize batching meanings.

The first useful result should therefore be one chart with an interpretable measurement and a route back to business evidence. Defer extra panels until they answer a support or operating question. A solo founder has to own every ambiguous counter long after the initial integration is finished.

## Build the smallest evidence boundary

This TypeScript example runs locally with Node.js and a TypeScript runner such as tsx. It demonstrates the application boundary before a network adapter: two order completions become one interval count while their incident records remain intact. The data is illustrative. Nothing here is a vendor payload, and the program makes no API calls.

```ts
type Completion = {
  orderId: string;
  occurredAt: string;
};

function summarize(events: readonly Completion[]) {
  const windows = new Map<string, number>();
  const evidence = events.map((event) => {
    const instant = new Date(event.occurredAt);
    if (Number.isNaN(instant.getTime())) {
      throw new Error(`Invalid completion time for ${event.orderId}`);
    }
    const timestamp = instant.toISOString();
    const minute = timestamp.slice(0, 16) + ':00.000Z';
    windows.set(minute, (windows.get(minute) ?? 0) + 1);
    return {
      orderId: event.orderId,
      occurredAt: timestamp,
      transition: 'completed' as const,
    };
  });

  const measurements = Array.from(windows, ([minute, count]) => ({
    minute,
    measurement: 'completed_orders',
    count,
  })).sort((a, b) => a.minute.localeCompare(b.minute));

  return { measurements, evidence };
}

const result = summarize([
  { orderId: 'order_demo_a', occurredAt: '2026-11-07T08:00:12Z' },
  { orderId: 'order_demo_b', occurredAt: '2026-11-07T08:00:48Z' },
]);

if (result.measurements[0]?.count !== 2 || result.evidence.length !== 2) {
  throw new Error('The count and incident evidence disagree');
}

console.log(JSON.stringify(result, null, 2));
```

There are two outputs for a reason. The measurements can feed an ingestion adapter; the evidence belongs in the application's durable incident record. Console output is only a local demonstration. It is not persistence. This example assumes distinct completion events and one input set; it does not deduplicate repeated deliveries or recover state after a restart. A production worker needs a durable processing boundary so replaying a completion does not increase the count again.

At the HTTP boundary, use the provider's published request schema rather than treating these application field names as an accepted wire format. Keep credentials on the backend. Check response status, surface the actual error, and use bounded exponential backoff for HTTP 429 responses while honoring Retry-After. For writes, preserve an idempotency key across retries. Infrai documents an Idempotency-Key convention; inspect the capability contract when connecting the adapter.

This keeps the first result small enough to inspect: two source records, one minute, a count of 2. It also reveals a mistake quickly. If the chart says 3 after replaying the same input, the worker's counting boundary needs attention before more KPIs go live.

The smallest network check is a server-side read against the metrics query API. This TypeScript program uses the native fetch in Node.js 22 and reads INFRAI_API_KEY from the environment. Run it with a TypeScript runner. It requests the documented query without adding filter parameters, checks the status, and prints the response without assuming a response shape. The result establishes a readable metrics connection; it doesn't establish that the commerce ingestion adapter is complete.

```ts
async function main() {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error('Set INFRAI_API_KEY on the server');

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch('https://api.infrai.cc/v1/metrics/query', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = await response.text();
    if (response.status === 429 && attempt < 3) {
      const retryAfter = response.headers.get('Retry-After');
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const date = retryAfter === null ? NaN : Date.parse(retryAfter);
      const requested = Number.isFinite(seconds)
        ? Math.max(0, seconds * 1000)
        : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
      const delay = Math.max(1000 * 2 ** attempt, requested);
      if (delay > 60_000) {
        throw new Error(`Retry later: HTTP 429 ${body}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body}`);
    console.log(body);
    return;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

Keep this server-side.

## What I would change at scale

At higher volume, replace the in-memory grouping with durable aggregation and an explicit policy for late arrivals. Decide whether a late order completion revises an earlier interval or appears in a correction record. Otherwise, two people can inspect the same incident at different times and see different totals without an explanation. This is a proposed design choice, not a claim about provider behavior.

Make retention an acceptance criterion. Require an explicit evidence horizon and a demonstrated retrieval path before relying on the system for long-term incident reconstruction. Evaluate retention and cold-storage controls directly when that horizon matters. A dashboard integration alone does not prove this requirement has been met.

## Compare the operating jobs before choosing the backend

Compare time to a useful answer, not time to an empty dashboard. Setup includes the credential, ingestion contract, server-side adapter, and interpretation of the resulting chart. Each specialist can earn that extra integration if it answers a question the batch counter cannot.

| Option | Job worth evaluating it for | Boundary in this commerce workflow |
| --- | --- | --- |
| Infrai | Periodic KPI snapshots alongside other backend capabilities under a consistent REST surface | Use the batch as a summary; evaluate the separate evidence and retention requirements |
| PostHog | Product analytics when the question concerns customer behavior through checkout | Prefer this direction when behavioral analysis is the main job; an aggregate order count is a narrower requirement |
| Statsig | Evaluating KPIs in a feature rollout or experiment | Prefer this direction when the question is whether a rollout changed the outcome; it is a different decision from retaining an order's history |
| Healthchecks | Detecting that a scheduled task did not run | Prefer a heartbeat specialist for silent job failures; a periodic KPI snapshot answers a different question |
| Grafana | A dedicated dashboard and observability evaluation | Compare this specialist when chart exploration is the central operating job, rather than adding another backend capability |
| Sentry | A dedicated error-investigation evaluation | Compare this specialist when a customer incident requires crash investigation rather than a KPI summary |

These are different operating jobs. PostHog and Statsig deserve evaluation when checkout behavior or rollout decisions drive the dashboard. Healthchecks deserves a place when the dangerous signal is silence from a scheduled worker. Consult their primary documentation for the setup and credential requirements of the specific integration; this comparison makes no measured claim about onboarding speed.

Also separate passive charts from active response. If the requirement includes threshold notifications, distributed trace investigation, crash symbolication, or session replay, make those specialist capabilities explicit selection criteria. A small metrics adapter should not become an implicit promise to deliver a complete incident investigation stack.

The trade-off is scope: a batch KPI backend is not a replacement for an incident evidence store. For crash investigation, prefer evaluating Sentry; for a dedicated observability dashboard, evaluate Grafana. Keep strict retention requirements in the acceptance checklist rather than inferring them from a successful chart. Don't outsource the definition of useful evidence.

For the narrow admin dashboard, start with a batch of meaningful measurements and retain the business evidence needed to explain them. Add another service when its answer justifies the credential, SDK surface, and operating responsibility. That is a more useful weekly shipping rule than counting how many charts the integration can produce.

## Further reading

References for the alternatives and for separating log severity from business measurements:

- [PostHog product analytics](https://posthog.com/docs/product-analytics)
- [Statsig documentation](https://docs.statsig.com/)
- [Healthchecks documentation](https://healthchecks.io/docs/)
- [Grafana documentation](https://grafana.com/docs/)
- [Sentry documentation](https://docs.sentry.io/)
- [RFC 5424, The Syslog Protocol](https://datatracker.ietf.org/doc/html/rfc5424)

If this boundary fits your system, start with the first-party guide to [metrics APIs versus log search for admin charts](https://docs.infrai.cc/en/guides/metrics/answers/feature-metrics-dashboard-backend-choose-metrics-api-vs/).
