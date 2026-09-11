# CRM automation release

The approved v24/v25 glass interface is extended with Calendar, Call Notes, Virtual Assistant and Appointment SMS. Existing global scoring and Nevada-only state priority remain unchanged. Official county records remain authoritative; RealEstateAPI remains discovery/enrichment only.

## Available without new provider credentials

- Cloud calendar: day/week/month, lead-linked appointments, callbacks, follow-ups, deadlines, attorney meetings and task due dates. Existing task/claim/lead deadlines appear automatically. Click to edit; drag to reschedule. Appointment overlaps are rejected atomically. Times are displayed/entered in the device timezone; the event retains its explicit timezone. All-day events use their entered date span.
- Call sessions, consent and participant jurisdiction records; manual notes or .txt transcript upload; private audio upload up to 20 MB and authenticated playback. Consent is required for uploaded transcripts/audio and provider transcription. No browser microphone recording or live telephone call is implied.
- Operator-entered structured summaries append once to lead notes. Summary, objections, commitments, next steps, sentiment, intent, confidence and stage proposal are stored separately. Manual summaries always require outcome review. AI-generated routine Contacted/Interested outcomes can apply automatically at >=0.90 confidence; no automatic backward movement. Other outcomes require human review.
- Verified contract evidence: executed agreement, e-sign confirmation, or counsel-approved verbal-contract evidence with counsel reference. Signed Contract is blocked at the database and server until evidence is recorded. An inference in a transcript is never evidence.
- Virtual Assistant: local CRM searches and a structured action builder for notes, allowed lead fields, pipeline changes, tasks, appointments, attorney assignments and event cancellation. High-impact actions require explicit confirmation. Proposals retain a lead snapshot and reject stale execution. Existing lead editor remains the place for compliance clearance and county-source facts.
- SMS consent/DNC records, templates, cadence and appointment-slot campaign drafts. Without the messaging connection they remain `provider_pending`, not queued/sent. Activation is explicit after connection. STOP and common explicit opt-out phrases block outreach and cancel pending messages. Other free-text responses pause the campaign for review. Numbered slot replies book atomically and create confirmation/reminder messages.
- Compact dashboard metrics below the existing dashboard priorities.

## Provider connections required

This release uses vendor-neutral HTTPS gateway contracts. These are adapters, not direct drop-in Twilio/OpenAI SDK integrations. Connect a trusted integration gateway that implements the following contracts for the selected vendors. A vendor API key alone is not sufficient.

All variables belong on the primary Railway service, server-side only. Never put values in client code, source control or a browser form.

| Connection | Server settings | Contract |
|---|---|---|
| LLM | `CRM_LLM_GATEWAY_URL`, `CRM_LLM_GATEWAY_TOKEN` | HTTPS POST, Bearer token, `operation: crm_query` returns `{answer: string, proposals?: [{lead_record_id, action}]}`; `operation: summarize_call` returns `{summary: {...}}` as below. |
| Speech-to-text | `CRM_STT_GATEWAY_URL`, `CRM_STT_GATEWAY_TOKEN` | HTTPS POST `{operation: transcribe, audio_url, session_id}`; returns `{text: string}`. Audio URL expires in 120 seconds. |
| SMS | `CRM_SMS_GATEWAY_URL`, `CRM_SMS_GATEWAY_TOKEN`, `CRM_SMS_FROM`, `CRM_WEBHOOK_SECRET`, `CRM_SMS_ENABLED=true` | HTTPS POST `{operation: send_sms, workspace_id, message_id, idempotency_key, from, to, body}`; returns `{provider_id: string}` only after provider acceptance. Gateway MUST honor idempotency keys and send signed inbound/delivery webhooks. Connect an approved business number and complete provider messaging registration before enabling. |
| Telephony | A call provider/business number plus the signed completed-call gateway below; `CRM_TELEPHONY_CONNECTED=true` after verification | Gateway sends completed-call metadata and consented transcript. Automatic summary runs when the LLM gateway is connected; otherwise the call awaits manual summary. |

Optional `CRM_CALL_CONFIDENCE_THRESHOLD` increases the automatic routine-outcome threshold (minimum 0.90, maximum 1.00).

LLM summary object:

```json
{"summary":"Facts only","key_notes":[],"objections":[],"commitments":[],"next_steps":[],"sentiment":"Neutral","intent":"Review documents","confidence":0.91,"proposed_stage":"Interested"}
```

The LLM is not given direct database tools. Its output is validated. CRM text and transcripts must be treated as untrusted data by the gateway. Natural-language answers may include up to five validated action proposals when the question explicitly requests a change. They are stored for human review and never executed directly by the LLM. Without an LLM, use the structured action builder. The gateway should minimize provider retention and enforce its own access controls.

## Signed provider webhook

POST `/api/automation/webhook` with JSON and these headers:

- `x-crm-timestamp`: Unix seconds; accepted within five minutes.
- `x-crm-signature`: lowercase hex HMAC-SHA256 of `timestamp + '.' + exact raw request body`, using `CRM_WEBHOOK_SECRET`.

Every webhook supplies `workspace_id` and unique `event_id`. The gateway derives workspace mapping from its trusted configuration, never an inbound sender's requested workspace. Retry with the same event ID; unique database keys prevent duplicate effects.

Inbound SMS:

```json
{"type":"sms_inbound","workspace_id":"workspace UUID","event_id":"unique inbound event","from":"+15555550100","body":"1"}
```

Delivery receipt:

```json
{"type":"delivery","workspace_id":"workspace UUID","event_id":"unique receipt event","message_id":"CRM message UUID","status":"delivered"}
```

`status` is `delivered` or `failed`. Distinguish inbound/receipt event IDs from the outbound `provider_id`.

Completed telephone call:

```json
{"type":"call_completed","workspace_id":"workspace UUID","event_id":"unique call event","lead_record_id":"CRM lead ID","title":"Claimant call","started_at":"2026-09-15T16:00:00Z","ended_at":"2026-09-15T16:20:00Z","participants":"Participants recorded by operator","jurisdiction_warning_acknowledged":true,"consent":{"status":"granted","jurisdiction":"Every participant location","basis":"Documented consent basis","recorded_at":"2026-09-15T16:00:00Z"},"transcript":"Consented transcript"}
```

Do not report consent granted without actual evidence. Automated call ingestion also requires the lead's Compliance Clearance to be CLEARED.

## Messaging behavior and operational limits

- Recipient must have explicit Qualified status, CLEARED compliance, opted-in matching phone consent, and no DNC. Eligibility is rechecked before each send and booking transaction.
- Maximum three invitation touches, at least 24 hours apart, within 14 days. Sends occur weekdays 09:00–17:00 in the recipient timezone; this is an operational policy, not jurisdiction-specific legal clearance.
- Worker polls every minute only with SMS fully configured and enabled. Existing drafts require explicit activation; adding credentials does not send them automatically.
- Gateway acceptance is `sent`, provider receipt is `delivered`. Provider errors/timeouts after a claimed attempt become `delivery_unknown` and are never retried automatically. Reconcile with the provider before taking further action. Interrupted attempts may remain `sending`; review them in the log.
- A STOP arriving during an already in-flight external send cannot retract that send. Pending invitations and reminders are cancelled and future dispatch is blocked.
- Appointment reminder times are 24 hours and 1 hour before the event, subject to sending hours and eligibility. Expired/cancelled events are not messaged. Ambiguous responses and booking conflicts enter human review.
- Calendars use a single user/workspace availability schedule; staff resource calendars, recurrence, external calendar sync, streaming audio and unattended execution of LLM-generated assistant proposals are not included.

## Data and audit guarantees

`crm_calendar_events`, `crm_call_sessions`, `crm_call_transcripts`, `crm_ai_summaries`, `crm_action_proposals`, `crm_assistant_actions`, `crm_messaging_campaigns`, `crm_messages`, `crm_messaging_consents`, and `crm_contract_evidence` are additive. Existing tables remain compatible. New tables use RLS with no public/browser grants, matching the existing server-mediated application model. Every workflow transaction writes `crm_audit_events`; if logging fails, its changes roll back. Private recordings use the `crm-call-recordings` storage bucket and authenticated server streaming.

All workflow writes go through `crm_automation_commit` with workspace ownership, current lead snapshots and row versions. A lead automation revision prevents stale legacy whole-payload uploads from overwriting new notes/status. If a stale-upload error appears, download cloud data and reapply the intended edit.

Duplicate sign-in repair archived 46 duplicate payloads in `crm_lead_duplicate_archive`, leaving 64 active leads. Their canonical IDs use earliest audit history. All original duplicates remain recoverable in the archive, including the malformed checklist encoding. Sign-in downloads canonical cloud leads; it preserves the old device copy under `surplusCRM_before_cloud_<user-id>`. Retired duplicate IDs cannot be reinserted. Separate explicit case numbers remain separate leads.

## Validation

Run `node --test test/*.test.js`. `test/automation-database.sql` exercises calendar, conflict prevention, notes append, evidence enforcement, stale updates, consent gates, tasks and audit inside a rolled-back transaction. The same checks have been run under the production service role without leaving test records. Production provider delivery still requires each actual vendor connection's acceptance test.
