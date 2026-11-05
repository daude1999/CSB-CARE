# AI CSB Coordinator with Claude (5 Nov 2026)

Branch `feature/claude-coordinator-integration`. Owner's brief: "Complete Claude API integration and intelligent CRM
automation". The approved Overview dashboard, sidebar, header and the floating launcher/panel position and look are
unchanged. The only visible changes are inside the panel: the status line says which mode is active, the paperclip
attaches a file, and the chat can show a "where should this go?" choice and an amber notice when Claude is not used.

## How it works

```
Employee message ──► askCsbCoordinator (server action, rota portal + serviceUser.documents)
                      └─► coordinatorChat (src/server/care/coordinator/agent.ts)
                           ├─ AI on? org switch in Rota Settings AND AI_PROVIDER=anthropic + key
                           ├─ limits: 40 AI messages/person/hour, 600/organisation/day (audit-log counts),
                           │          3 at once per organisation per server instance
                           ├─ yes ─► Claude (AnthropicProvider.runCoordinatorAgent): manual tool loop,
                           │         ≤6 model requests, ≤55 s, ≤4,000 output tokens per request
                           │           └─ tools (agent-tools.ts), each run with the employee's ctx
                           └─ no / over limit / outage ─► built-in CRM answers (crm-assistant.ts, #88/#92)
                                                        + "process this support plan" deterministic summary
Paperclip ──► uploadToCoordinator ─► uploadFromChat (chat-upload.ts) ─► addDocuments (existing intake upload)
```

### Tools Claude can call (the complete list)

| Tool | Does | Writes? |
|---|---|---|
| `search_records` | Service users and intakes the employee may see | no |
| `list_open_intakes` | Open intakes with status and open facts | no |
| `get_service_user` | Non-clinical summary (existing `serviceUserChatContext`) | no |
| `get_intake` | Extracted facts with document/page/quote, nine care plan sections and gaps, risks, package, visits, weekly minutes vs authorised, conflicts, flags | no |
| `get_section_drafts` | One section's drafts fact by fact | no |
| `get_review_steps` | Open facts, manager approval per section, save to record, follow-ups, rota readiness gates | no |
| `crm_lookup` | The built-in CRM answers (risks due, plans awaiting approval, unassigned, missed, unavailable staff, why-not, package gaps, policy) | no |
| `create_intake` | Starts a DRAFT intake (re-uses one with the same title from the same person in the last 10 minutes) | draft only |
| `read_documents` | Reads unread PDFs already on an intake (≤2 per message; never re-reads a READ document) | draft facts only |

There is no tool to approve, submit, save to a record, publish, assign, send or delete, and no tool takes SQL, code, a
URL or an organisation id. Approvals, saving and the rota stay in the existing screens with separation of duties.

### Safeguards

- Tenancy and roles: every tool goes through the existing services (`getIntake`, `listIntakes`, `intakeInScope`,
  `serviceUserWhere`, `coordinatorAccess`), so organisation, branch, area and role checks are the screens' own.
  Restricted facts stay hidden unless the employee has `serviceUser.sensitive`.
- Prompt injection: the system prompt marks tool results and document text as untrusted; results are JSON; and the
  real protection is that no tool can approve, publish or change a record.
- Source grounding: facts carry document, page, quote and whether the quote was found on the page. Risk levels are
  never read in (`levelFromDocument` only when the document states it and a person confirmed it).
- Documents are only sent to the AI provider by the existing reader, and only when the organisation's AI switch is on.
  The chat itself sends Claude the tool results, never the PDF.
- Audit: `coordinator.chat.asked` per message with mode, model, token counts, estimated cost, tool names, records
  written, duration. Never the question, answer or document text. Uploads and reads keep their existing audit entries.

### Cost assumptions

Model: `ANTHROPIC_MODEL` if set, otherwise `claude-opus-5-5` (list price $4 / $20 per million input/output tokens,
cache reads $0.20). Effort is `medium`. A typical message is 2 to 4 model requests of about 4,000 to 8,000 input tokens
(system prompt and tools cached after the first) and 300 to 800 output tokens: roughly $0.02 to $0.06. A full
"process everything" turn is about $0.05 to $0.12. 15 coordinators × 40 messages a day ≈ 600 messages ≈ $15 to $35 a
day at most; the organisation daily limit (600) caps it. Document reading by AI (existing reader) is extra: about
$0.05 to $0.30 per support plan depending on pages. These are estimates, not a bill; the audit log keeps the token
counts, and `coordinatorAiUsage()` sums the last 30 days.

### Production settings

- `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` (already set on Vercel per the owner).
- Optional: `ANTHROPIC_MODEL` (leave unset), `COORDINATOR_AI_USER_HOURLY` (default 40), `COORDINATOR_AI_ORG_DAILY` (600).
- An organisation admin switches AI on in Rostering → Settings → "AI reading for Care Coordinator", recording who
  authorised it (data-protection note). That one switch covers AI document reading and the Claude chat.

### Limitations (not built)

- No streaming: the reply appears when Claude has finished (typically 5 to 20 seconds).
- Limits are per server instance for concurrency; the hourly/daily limits are global (audit log).
- The "same message twice" protection for uploads and reads is per server instance plus SHA-256 checks in the database.
- Claude prepares and reports drafts. Turning drafts into records is still: coordinator check → submit → manager
  approval per section → Save to record → care plan and risks approved by a different person → unpublished rota.
- Live end-to-end test against the real Anthropic API was not possible from the build environment (no key there);
  tests use a scripted provider through the real tools, database and reading pipeline.
