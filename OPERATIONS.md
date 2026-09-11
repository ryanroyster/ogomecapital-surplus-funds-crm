# v25 operating workflows

The existing glass UI, confirmed leads, communications, auction discovery and global expected-value ranking are preserved. Nevada's state workspace alone orders Olga Ohm, Timothy B. Murri, then Carl F. Leonard / Eva J. Leonard first. No priority or probability field is changed by that queue.

Open a lead profile for Compliance & Company Operations. Edit compliance through the lead editor. Tasks, attorneys, claims and payments have inline create/edit forms. Record approved recovery and company fee amounts on claims; record actual received company fees as payments for revenue reporting. A recovery payment is not company revenue.

Compliance fields are additive fields in `crm_leads.payload`. Missing status reads as `NOT_REVIEWED`, with other unverified fields null. Defaults do not require a database migration or a bulk write to existing records. Legal terms are not copied from state research. Texas retains its restricted attorney-only research label. County records remain authoritative; RealEstateAPI is discovery/enrichment.

Both API and UI reject new Call Ready transitions unless compliance is CLEARED. Historical Call Ready payloads remain intact, show a clearance warning, and are excluded from readiness counts and the actionable Call Ready column until cleared.

## API and data safety

Authenticated, server-mediated endpoints: `/api/cloud/tasks`, `/attorneys`, `/claims`, `/payments` support GET, POST and PATCH `/:id`. `/api/cloud/audit-events` is read-only and logs server-side changes. All paths have the `/api/cloud` prefix. Related lead, attorney and claim references are validated against the authenticated record owner. The current foundation uses individual user-owned workspaces: assignees are self or unassigned; organization-wide task delegation is not implied.

Lead PUT now merges by stable ID, preserves omitted fields and records, and validates the complete batch before writing. Explicit lead deletion is a separate authenticated DELETE endpoint. The existing lead editor preserves communications and other fields outside the form. Saved payloads and scores are restored after legacy seed routines at startup. Server files, credentials and repository metadata are no longer exposed by the static file handler.

Operating records use user-scoped localStorage caches and an ordered pending sync queue (attorneys before claims before payments). Lead changes are uploaded before dependent operating records. Failed saves remain locally available for retry. Client-generated IDs make create retries idempotent. Lead saves queue edits made during an upload, and pending lead changes are retried before a cloud download. Communications use the same save path.

Audit inserts follow successful writes; an audit-storage failure returns an explicit warning, not a false failed-save response. Audit writes and record writes are not a database transaction. Cross-device editing of the same payload still follows the existing last-save-wins model. No organization/RLS policies or database schema were changed.

## Verification

Run `node --test`. Covers legacy upcoming sync and RealEstateAPI mapping plus scoped Nevada ordering, historical clearance, non-destructive saves, authentication/ownership checks, related-record validation, all operating create/update paths, retries, audit creation and KPI calculations. Live table compatibility was verified with synthetic inserts into all five operating tables inside a rolled-back transaction. Production test records were not retained.
