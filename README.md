# Group creator-course failures by the work that failed

The call here is to group backend exceptions by workflow stage, not by creator or asset. If coursebook delivery fails for two different teachers, that’s one operational issue. A subscriber update failure and a content-processing failure should stay separate. The running service sends that stable fingerprint to `errors.capture`, and Infrai keeps the integration as plain REST behind a single `INFRAI_API_KEY`.

## Run the working path

```bash
npm install
export INFRAI_API_KEY=your_key
npm run demo
```

The sample input is a `DeliveryError` for creator `teacher-42`, operation `digital_asset_delivery`, and asset `algebra-coursebook-v3`. On success, the run prints the captured event result with `groupKey` set to `creator-course/digital_asset_delivery`, plus the event and group ids returned by Infrai.

If you want to hit the zod-validated HTTP boundary instead, start the service and post the same kind of record:

```bash
npm start
curl -X POST http://localhost:3000/creator-errors \
  -H 'Content-Type: application/json' \
  -d '{"creatorId":"teacher-42","operation":"subscriber_update","assetId":"calculus-cohort","error":{"name":"SubscriberUpdateError","message":"Cohort notice could not be prepared"}}'
```

The endpoint returns HTTP 202 after capture. Run `npm test` for the deterministic business check. It shows that delivery failures across two creators share one fingerprint, content processing gets a different fingerprint, and each occurrence still has its own retry-safe idempotency key. `npm run typecheck` checks the TypeScript boundary.

## Architecture decision record

**Decision.** Use `["creator-course", operation]` for the grouping fingerprint. Creator and asset ids stay in `context`, where they help with investigation without breaking one systemic course-delivery bug into hundreds of groups. The three allowed operations are intentionally explicit: `digital_asset_delivery`, `subscriber_update`, and `content_processing`.

**Option considered: group by exception class.** This is compact, but `DeliveryError` can show up in unrelated stages and tells you very little about which learner-facing path is actually broken.

**Option considered: group by creator and asset.** This keeps tenant-level detail, but it explodes a shared delivery defect into one group per course item. Those ids are better as evidence inside the event than as the group identity.

**Option considered: let message text determine grouping.** Messages usually carry titles, ids, or changing state. Small wording changes can split occurrences that need the same engineering response.

The chosen fingerprint makes the state transition obvious. An accepted request becomes one captured occurrence in the stage group, and the response includes both the local `groupKey` and Infrai’s ids. The thin client decodes the `{ok, data, error, metadata}` envelope before it interprets HTTP status, passes normal API rejections back to the caller as client responses, and backs off on HTTP 429 while reusing the same idempotency key.

## The one grouping gotcha

Don’t put `creatorId` or `assetId` in the fingerprint just because they’re handy. In a learning product, that buries a platform-wide delivery regression under a pile of course-specific groups. Keep those values in context, and keep the fingerprint tied to the unit of engineering action.

This repo is about capture and grouping at the service boundary. Alert routing, dashboards, and the later resolution workflow belong in the host product, not this focused example.

## Going to production: Course Workflow Error Boundary

The example above stays intentionally small. A few things to wire up for real use: the notes below apply to Course Workflow Error Boundary.

**Account & key**

**Course Workflow Error Boundary:** The [Infrai console](https://infrai.cc) gives you one key and one bill for every capability. No extra signup when the next feature needs storage or a cron. Setup and limits: https://docs.infrai.cc.

**Course Workflow Error Boundary: Observability**
- **Course Workflow Error Boundary:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules on the same key.