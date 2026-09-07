---
title: FocusFlow MVP Product Specification
status: draft-for-wayfinding
version: 1.0
audience:
  - product owner
  - software architect
  - developers
  - QA engineers
primary_users:
  - professionals
  - knowledge workers
product_type: responsive web application
repository_name: task-focus-timer
working_product_name: FocusFlow
last_updated: 2026-09-05
---

# FocusFlow — Implementation-Ready MVP Specification

## 1. Purpose of this document

This document is the starting point for a Wayfinder-led product and
engineering workflow.

Wayfinder should:

1. Inspect this specification and the repository.
2. Identify ambiguity, contradictions, missing decisions, and hidden risks.
3. Ask focused questions before making irreversible technical decisions.
4. Update this document when product requirements are clarified.
5. Propose architecture and implementation plans separately from this file.
6. Convert the approved scope into trackable implementation issues.
7. Avoid implementation until the destination, constraints, and acceptance
   criteria are sufficiently clear.

This specification is authoritative for product scope unless superseded by an
accepted Architecture Decision Record (ADR) or an explicitly approved product
change.

---

# 2. Product destination

Build a responsive web application for professionals and knowledge workers
that connects a lightweight personal task list to a Pomodoro-style focus timer
and descriptive individual productivity analytics.

The core product loop is:

> Create or select a task, focus on it for a defined interval, and understand
> where focused time was spent.

The application is a personal productivity tool. It is not a project
management suite, collaboration platform, employee-monitoring system, or
workplace-surveillance product.

---

# 3. Decisions already made

The following decisions should be treated as settled unless implementation
research reveals a serious conflict:

1. **Primary user:** Professionals and knowledge workers.
2. **Principal outcome:** A focus timer connected to task management.
3. **Task model:** A standalone lightweight personal task list.
4. **Identity model:** User accounts with server-side persistence.
5. **Product boundary:** Personal productivity plus individual analytics.
6. **Delivery target:** An implementation-ready MVP for a developer or
   development team.
7. **Client:** Responsive web application.
8. **Collaboration:** Excluded from the MVP.
9. **External task integrations:** Excluded from the MVP.
10. **Analytics:** Private, descriptive, and individual only.

---

# 4. MVP success criteria

The MVP is successful when a registered user can:

- Create and manage a personal task list.
- Select a task and start a focus interval linked to it.
- Pause, resume, complete early, or cancel an interval.
- Progress through focus, short-break, and long-break intervals.
- Refresh or temporarily leave the page without corrupting timer state.
- Return in another browser or device and access persisted tasks and history.
- Review daily and seven-day focus summaries.
- Understand focused time by task and category.
- Use the primary workflow on desktop and mobile browsers.
- Delete their account and associated personal data.

Suggested product metrics:

- Percentage of new users who complete at least one focus interval.
- Completed focus intervals per active user per week.
- Percentage of focus intervals linked to tasks.
- Focus-session completion versus cancellation rate.
- Weekly returning-user rate.
- Percentage of active users who view analytics.

Telemetry must never contain task titles, task notes, or other user-authored
content.

---

# 5. MVP scope

## 5.1 Included

- Email-based account registration and authentication.
- Email verification.
- Login and logout.
- Password reset.
- Account deletion.
- Lightweight personal task management.
- Pomodoro-style focus timer.
- Short and long breaks.
- Configurable timer settings.
- Server-authoritative timer persistence.
- Session history.
- Individual daily and seven-day analytics.
- Browser sound and notifications.
- User timezone support.
- Responsive desktop and mobile UI.
- Keyboard-accessible primary workflows.
- Basic production monitoring, backups, and security controls.

## 5.2 Explicitly excluded

- Teams and organizations.
- Shared tasks or shared projects.
- Manager dashboards.
- Employee monitoring.
- Public profiles.
- Social features and leaderboards.
- Projects, subtasks, dependencies, kanban boards, and Gantt charts.
- Calendar integrations.
- Third-party task integrations.
- Billing and subscriptions.
- Native mobile or desktop applications.
- Offline synchronization.
- AI recommendations.
- Predictive analytics.
- Automatic website or application tracking.
- Manual editing of historical focus durations.
- Real-time cross-device synchronization using WebSockets.
- Custom reporting dashboards.

---

# 6. Default timer behavior

| Setting                             |             Default | Allowed range |
| ----------------------------------- | ------------------: | ------------: |
| Focus duration                      |          25 minutes | 1–120 minutes |
| Short break                         |           5 minutes |  1–60 minutes |
| Long break                          |          15 minutes |  1–60 minutes |
| Focus intervals before long break   |                   4 |          1–10 |
| Automatically start breaks          |                 Off |        On/off |
| Automatically start focus intervals |                 Off |        On/off |
| Sound                               |                  On |        On/off |
| Browser notifications               | Off until permitted |        On/off |

A “Pomodoro” in analytics means a completed focus interval, regardless of its
configured duration. The application must report both completed interval count
and actual focused minutes.

---

# 7. Core user journeys

## 7.1 First use

1. The visitor creates an account.
2. The visitor verifies their email if required by the selected auth provider.
3. The user signs in.
4. The application displays the focus workspace.
5. The user creates a task.
6. The user selects that task.
7. The user starts a focus interval.
8. The timer expires or the user completes it early.
9. The application records the completed interval.
10. The application proposes the appropriate break.
11. History and analytics reflect the completed focus time.

## 7.2 Returning use

1. The user signs in.
2. The application loads incomplete tasks, settings, and any current interval.
3. The user selects an existing task or creates another.
4. The user starts or resumes the timer.
5. The timer remains correct through tab inactivity and refresh.
6. The user later reviews history and analytics.

## 7.3 Task completion

1. The user marks a task complete.
2. The application records its completion timestamp.
3. The task leaves the default active-task view.
4. Historical focus sessions remain linked to it.
5. The user can find it through a completed-task filter.
6. The user can reopen it.

---

# 8. Functional requirements

## 8.1 Authentication and account management

Users must be able to:

- Register using email and password.
- Verify their email address.
- Log in and log out.
- Request and complete a password reset.
- Remain authenticated across browser refreshes using secure sessions.
- Delete their account and associated personal data.

Rules:

- Email addresses must be normalized and unique.
- Passwords must contain at least eight characters unless a managed
  authentication provider applies a stronger policy.
- Passwords must never be stored in plaintext.
- Protected operations must derive user identity from the authenticated
  session, never from a client-provided user ID.
- Login, registration, and password-reset endpoints must be rate-limited.
- Account deletion requires explicit confirmation.
- A managed authentication provider is acceptable and preferred if it reduces
  security risk and implementation cost (locked: managed preferred; exact
  vendor chosen in architecture).
- Email verification is sent at registration but does not block first use;
  unverified users may create tasks and run timers with a verification nag
  until verified.
- Completed tasks are retained indefinitely until the user deletes them or
  deletes the account; deleting a task preserves its session snapshots.
- Account deletion purges live personal data immediately on confirmation;
  backups age out within 30 days per the published retention policy.

## 8.2 Task management

Each task has:

- Required title.
- Optional notes.
- Optional single category.
- Status: `active`, `completed`, or `archived`.
- User-controlled position.
- Creation timestamp.
- Last-updated timestamp.
- Optional completion timestamp.
- Optional soft-deletion timestamp.

Users can:

- Create a task.
- View active tasks.
- Edit a task.
- Complete a task.
- Reopen a completed task.
- Archive or delete a task.
- Reorder active tasks.
- Filter active and completed tasks.
- Select a task for the next focus interval.

Rules:

- Title length is 1–200 characters after trimming.
- Notes length is at most 2,000 characters.
- Category length is at most 50 characters.
- Completing or deleting a task must not delete its session history.
- Deleting a task with sessions must preserve task-title and category
  snapshots on those sessions.
- Unassigned focus intervals are permitted, but the UI should encourage task
  selection.
- Only one task can be associated with a focus interval.
- A task cannot be changed while its focus interval is running or paused.
- The MVP has one optional category field, not a many-to-many tagging system.

## 8.3 Timer state model

Timer states:

```text
running
paused
completed
cancelled
```

The absence of a current timer represents the idle state.

Interval types:

```text
focus
short_break
long_break
```

Required controls:

- Start.
- Pause.
- Resume.
- Cancel.
- Complete early.
- Skip break.

“Complete early” and “Cancel” have different meanings:

- **Complete early:** Finalizes the interval as completed and records actual
  elapsed active time.
- **Cancel:** Finalizes the interval as cancelled. Its elapsed time does not
  count toward completed-focus totals.

## 8.4 Timer correctness

The UI must not use a decrementing browser counter as the source of truth.

The server-authoritative timer record must include:

- Start timestamp.
- Expected end timestamp.
- Pause timestamp when paused.
- Accumulated paused duration.
- Completion or cancellation timestamp.
- Planned duration.
- Actual active duration.

The displayed remaining time must be calculated from timestamps. Client-side
ticks exist only to update the visual display.

Rules:

- Refreshing the page restores a running or paused interval.
- A user may have at most one running or paused interval.
- Starting another interval while one exists returns a conflict response.
- Server operations that transition timer state must be atomic.
- Completion requests must be idempotent.
- The server, not the client, calculates final elapsed active time.
- If another device changes timer state, the client reconciles on visibility
  change, navigation, and important timer actions.
- WebSockets are not required for the MVP.
- A timer that expires while the application is closed is reconciled on the
  next server interaction: if returned within 60 minutes past `expected_end_at`,
  it auto-finalizes as completed exactly once; if more than 60 minutes past,
  the client prompts for confirmation (`Complete` finalizes as completed with
  actual duration bounded by planned duration; `Discard` finalizes as
  cancelled with no completed minutes and no cycle increment) and finalizes
  only on explicit user action.
- Reconciliation must create no duplicate session or analytics entries.

## 8.5 Focus-cycle rules

- Only a focus interval that reaches its expected end increments the
  focus-cycle count. `Complete early` finalizes the interval as completed and
  records actual elapsed active time for history/analytics, but does not
  increment the focus-cycle count.
- Cancelling (including `Discard` from expired-confirmation) does not increment it.
- After the configured number of completed focus intervals, the next proposed
  break is long.
- Otherwise, the next proposed break is short.
- Completing or skipping a long break resets the focus-cycle count.
- Break duration never contributes to focused-time metrics.
- Paused duration is excluded from actual active duration.
- Settings changes apply to newly created intervals, not an interval already
  running or paused.
- When auto-start is disabled, completion waits for explicit user action
  before starting the next interval.
- When auto-start is enabled, the next appropriate interval is created and
  started after the previous interval is finalized.

## 8.6 Completion behavior

When an interval reaches its expected end:

- It is finalized exactly once.
- Its actual duration is recorded.
- A sound plays if enabled and allowed.
- A browser notification appears if enabled and permitted.
- History reflects the new record.
- Analytics reflect completed focus intervals.
- The application proposes or starts the appropriate next interval.

## 8.7 Settings

Users can configure:

- Focus duration.
- Short-break duration.
- Long-break duration.
- Number of focus intervals before a long break.
- Automatic break start.
- Automatic focus start.
- Sound.
- Browser notifications.
- Timezone.

Timezone must:

- Initially be inferred from the browser.
- Be stored as an IANA timezone, such as `Europe/Berlin`.
- Be user-editable.
- Determine daily and weekly reporting boundaries.

## 8.8 Session history

History is reverse chronological and contains:

- Interval type.
- Linked task title or “Unassigned.”
- Start time.
- Completion or cancellation time.
- Actual duration.
- Status.

Required filters:

- Today.
- Last seven days.
- Last 30 days.
- Focus only.
- All interval types.

History is read-only in the MVP and must be paginated. Short and long breaks
are persisted in history by default; `Focus only` / `All interval types`
filters control their display.

## 8.9 Individual analytics

Required periods:

- Today (user's local calendar day).
- Last seven days (rolling 7 local calendar days including today, not a calendar week).

Required metrics:

- Total completed focus minutes.
- Number of completed focus intervals.
- Number of completed tasks.
- Focus-session completion rate.
- Daily focus minutes.
- Focus minutes grouped by task.
- Focus minutes grouped by category.
- Average completed focus-session duration.

Definitions:

```text
completed_focus_minutes =
  sum(actual_duration_seconds for completed focus intervals) / 60

focus_completion_rate =
  completed focus intervals /
  (completed focus intervals + cancelled focus intervals)

completed_tasks =
  tasks whose completed_at is inside the reporting period
```

Rules:

- Breaks are excluded from focus metrics.
- Cancelled sessions contribute to the completion-rate denominator but
  contribute no completed-focus minutes.
- Day boundaries use the user’s saved timezone.
- Analytics are computed from source records rather than being the only stored
  representation of those records.
- Deleted tasks remain reportable through session snapshots.
- Empty analytics must have an explanatory empty state.
- A daily bar chart and ranked task/category lists are sufficient (locked for MVP).
- Every chart must have an accessible textual or tabular equivalent.
- MVP is English-only with i18n-ready strings (no multi-language translation pipeline).
- Product name locked as FocusFlow for MVP with minimal visual identity; full branding deferred post-MVP.

---

# 9. Information architecture

## 9.1 Public routes

```text
/
 /login
 /register
 /forgot-password
 /reset-password
```

## 9.2 Authenticated routes

```text
/app
/app/tasks
/app/history
/app/analytics
/app/settings
```

## 9.3 Workspace layout

Desktop:

- Task list and quick-add control on the left.
- Selected task, timer, interval type, and controls in the main area.
- Navigation to Focus, Tasks, History, Analytics, and Settings.

Mobile:

- Timer appears first.
- Selected task and task picker appear below it.
- Primary sections use compact or bottom navigation.
- All critical timer actions remain reachable without horizontal scrolling.

---

# 10. Conceptual data model

A relational database is recommended.

## 10.1 Users

```text
users
- id: UUID, primary key
- email: normalized unique text
- timezone: IANA timezone
- created_at: UTC timestamp
- updated_at: UTC timestamp
```

Authentication identity may be managed by an external provider.

## 10.2 User settings

```text
user_settings
- user_id: UUID, primary and foreign key
- focus_duration_seconds: integer, default 1500
- short_break_seconds: integer, default 300
- long_break_seconds: integer, default 900
- intervals_before_long_break: integer, default 4
- auto_start_breaks: boolean, default false
- auto_start_focus: boolean, default false
- sound_enabled: boolean, default true
- notifications_enabled: boolean, default false
- updated_at: UTC timestamp
```

## 10.3 Tasks

```text
tasks
- id: UUID, primary key
- user_id: UUID, indexed foreign key
- title: varchar(200)
- notes: varchar(2000), nullable
- category: varchar(50), nullable
- status: active | completed | archived
- position: sortable numeric value
- created_at: UTC timestamp
- updated_at: UTC timestamp
- completed_at: UTC timestamp, nullable
- deleted_at: UTC timestamp, nullable
```

## 10.4 Timer sessions

```text
timer_sessions
- id: UUID, primary key
- user_id: UUID, indexed foreign key
- task_id: UUID, nullable foreign key
- task_title_snapshot: varchar(200), nullable
- category_snapshot: varchar(50), nullable
- interval_type: focus | short_break | long_break
- status: running | paused | completed | cancelled
- planned_duration_seconds: integer
- actual_duration_seconds: integer, nullable until finalized
- started_at: UTC timestamp
- expected_end_at: UTC timestamp
- paused_at: UTC timestamp, nullable
- accumulated_pause_seconds: integer, default 0
- completed_at: UTC timestamp, nullable
- cancelled_at: UTC timestamp, nullable
- created_at: UTC timestamp
- updated_at: UTC timestamp
```

## 10.5 Focus-cycle state

```text
focus_cycle_state
- user_id: UUID, primary and foreign key
- completed_focus_count: integer
- updated_at: UTC timestamp
```

## 10.6 Required constraints

- Every query is scoped to the authenticated user.
- A unique partial constraint permits at most one `running` or `paused`
  session per user.
- Sessions are indexed by `(user_id, started_at)`.
- Tasks are indexed by `(user_id, status, position)`.
- All timestamps are stored in UTC.
- Session completion and focus-cycle updates occur in one transaction.
- Database-level constraints protect valid duration ranges and timer states
  where practical.

---

# 11. API behavior

REST is sufficient for the MVP, but Wayfinder may recommend another interface
if it provides a concrete benefit.

## 11.1 Tasks

```http
GET    /api/tasks?status=active
POST   /api/tasks
PATCH  /api/tasks/:id
POST   /api/tasks/:id/complete
POST   /api/tasks/:id/reopen
DELETE /api/tasks/:id
POST   /api/tasks/reorder
```

## 11.2 Timer

```http
GET  /api/timer/current
POST /api/timer/start
POST /api/timer/pause
POST /api/timer/resume
POST /api/timer/complete
POST /api/timer/cancel
POST /api/timer/skip-break
```

Example start payload:

```json
{
  "intervalType": "focus",
  "taskId": "optional-task-uuid"
}
```

The server obtains planned duration from saved settings. The client must not
supply authoritative final elapsed time.

## 11.3 History and analytics

```http
GET /api/sessions?from=...&to=...&type=focus&cursor=...
GET /api/analytics/summary?period=today
GET /api/analytics/summary?period=7d
```

## 11.4 Settings

```http
GET   /api/settings
PATCH /api/settings
```

## 11.5 API conventions

- JSON request and response bodies.
- UTC ISO 8601 timestamps.
- Runtime validation for all external input.
- Consistent error envelopes.
- Pagination for history and completed tasks.
- Idempotency protection for finalization operations.
- `409 Conflict` for incompatible timer transitions.
- No endpoint accepts an arbitrary user ID to authorize personal data.

Example error:

```json
{
  "error": {
    "code": "ACTIVE_TIMER_EXISTS",
    "message": "Finish or cancel the current interval before starting another."
  }
}
```

---

# 12. Nonfunctional requirements

## 12.1 Performance

- The primary authenticated view should become usable within three seconds on
  a typical broadband connection.
- Common API reads should target p95 below 500 ms, excluding documented cold
  starts.
- Timer display should reconcile to within one second when a tab becomes
  visible.
- Analytics for a normal personal account should load within two seconds.

## 12.2 Security and privacy

- HTTPS only in production.
- Secure, HTTP-only, same-site cookies where cookie sessions are used.
- CSRF protection for cookie-authenticated mutations.
- Server-side authorization for every resource.
- Rate limiting for authentication and sensitive mutations.
- Secrets managed outside source control.
- User-authored task content excluded from logs and telemetry.
- Account deletion removes or irreversibly anonymizes personal data according
  to a published retention policy.
- Dependency and secret scanning should run in CI.
- Timer state transitions must be validated server-side.
- Error responses must not leak whether another user’s resource exists.

## 12.3 Accessibility

Primary workflows target WCAG 2.1 AA:

- Full keyboard operation.
- Visible focus indicators.
- Semantic headings, forms, and buttons.
- Timer state changes announced accessibly without announcing every tick.
- No information conveyed by color alone.
- Sufficient color contrast.
- Reduced-motion preference respected.
- Charts have accessible text or tables.
- Dialogs manage focus correctly.
- Validation errors are associated with their fields.

## 12.4 Browser support

Support the latest two stable versions of:

- Chrome.
- Edge.
- Firefox.
- Safari.

Layouts must support viewport widths from approximately 320 pixels upward.

## 12.5 Reliability and observability

- Structured server logs with request IDs.
- Frontend and backend error monitoring.
- Health-check endpoint where deployment architecture permits it.
- Automated database backups.
- Production migration strategy.
- No product-analytics telemetry in the MVP per delivery constraint; suggested
  §4 metrics, if needed, are server-side DB-derived aggregates, not client events.
- No user-authored task content in logs, error reports, or telemetry.
- Recovery behavior for expired or interrupted timers must be tested.

---

# 13. Acceptance criteria

## 13.1 Tasks

```gherkin
Given an authenticated user
When the user creates a task with a valid title
Then the task appears in the active task list
And it remains available after logout and login
```

```gherkin
Given a task has recorded focus sessions
When the user deletes the task
Then the task no longer appears in active tasks
And historical sessions retain task and category snapshots
```

```gherkin
Given two authenticated users
When one user requests the other user's task
Then no task data is exposed
And the response is forbidden or not found
```

## 13.2 Timer

```gherkin
Given the user has selected a task
When the user starts a focus interval
Then exactly one running session is created
And it is linked to the selected task
And planned duration and expected end time are persisted
```

```gherkin
Given a focus interval is running
When the user refreshes the page
Then the same interval is restored
And remaining time is calculated from authoritative timestamps
```

```gherkin
Given a focus interval is paused
When five minutes pass
Then those five minutes do not reduce remaining focus time
And they are excluded from actual focus duration
```

```gherkin
Given an interval is running
When the same user attempts to start another interval
Then the server rejects the request with a conflict
And no second active session is created
```

```gherkin
Given expected_end_at passes while the application is closed
When the user returns
Then the interval is reconciled as completed exactly once
And it appears once in history and analytics
```

```gherkin
Given two clients attempt to complete the same interval
When both requests reach the server
Then the interval is finalized once
And focus-cycle state increments once
```

## 13.3 Analytics

```gherkin
Given the user completes a 25-minute focus interval
When analytics are loaded
Then completed focus minutes increase by 25
And completed focus interval count increases by one
```

```gherkin
Given the user cancels a focus interval
When analytics are calculated
Then the interval contributes to the completion-rate denominator
But contributes no completed-focus minutes
```

```gherkin
Given the user's timezone differs from UTC
When daily statistics are calculated
Then sessions are grouped by the user's local calendar-day boundaries
```

```gherkin
Given a daylight-saving transition occurs
When analytics are calculated
Then local day grouping remains correct
And stored UTC timestamps are not modified
```

---

# 14. Recommended implementation milestones

## Milestone 1 — Repository and architecture foundation

- Initialize repository and development tooling.
- Select application framework and deployment platform.
- Configure strict TypeScript.
- Configure formatting, linting, tests, and CI.
- Configure authentication.
- Define database schema and migrations.
- Define authorization boundaries.
- Create architecture and testing ADRs.

Exit criteria:

- CI passes.
- Authentication works in a test environment.
- Database migrations are repeatable.
- Cross-user authorization tests exist.

## Milestone 2 — Tasks

- Implement task persistence and APIs.
- Implement task-list UI.
- Add create, edit, complete, reopen, archive/delete, and reorder actions.
- Add active and completed filters.
- Add loading, empty, and error states.

Exit criteria:

- Task acceptance criteria pass.
- Data remains isolated by user.
- Task interactions work with keyboard and mobile layouts.

## Milestone 3 — Timer

- Implement server-authoritative timer lifecycle.
- Implement pause, resume, complete, cancel, and skip-break actions.
- Implement refresh restoration.
- Implement expired-session reconciliation.
- Implement focus-cycle rules.
- Add sounds and browser notifications.

Exit criteria:

- Timer lifecycle and concurrency tests pass.
- Refresh, hidden-tab, and expired-session scenarios pass.
- Duplicate finalization is prevented.

## Milestone 4 — History and analytics

- Implement paginated history.
- Implement timezone-aware daily and seven-day aggregation.
- Add metric cards, daily chart, and task/category breakdown.
- Add accessible chart equivalents.
- Test empty states and deleted-task snapshots.

Exit criteria:

- Analytics definitions match this specification.
- Timezone and daylight-saving tests pass.
- History remains intact after task deletion.

## Milestone 5 — Release readiness

- Accessibility audit.
- Cross-browser and responsive testing.
- Security review and rate limiting.
- Error monitoring and backups.
- Account deletion flow.
- Privacy policy.
- Production deployment and smoke tests.

---

# 15. Definition of done for the MVP

The MVP is ready for beta release when:

- All critical acceptance criteria pass.
- A user can complete the registration-to-analytics journey.
- Timer state survives refresh and tab inactivity.
- Expired timers reconcile correctly after the application was closed.
- Concurrent requests cannot create multiple active timers.
- Duplicate completion cannot double-count focus time.
- Users cannot access one another’s records.
- Daily analytics are correct across timezones and daylight-saving changes.
- Primary workflows are keyboard accessible.
- Supported browsers pass desktop and mobile smoke tests.
- Production uses HTTPS, managed secrets, backups, monitoring, and rate
  limiting.
- Account deletion and privacy disclosures are available.
- No excluded collaboration or surveillance features are required for release.

---

# 16. Decisions Wayfinder must resolve before implementation

Wayfinder should inspect the repository and ask the owner to approve the
following decisions one at a time. Each durable decision should be recorded in
an ADR.

## 16.1 Product decisions

1. Should email verification be mandatory before using the application?
2. Should completed tasks be retained indefinitely?
3. What exact retention period applies after account deletion?
4. Should “complete early” count toward the long-break cycle regardless of how
   little time elapsed?
5. Should a focus interval that expires while the app is closed always be
   treated as completed, or should long absences require confirmation?
6. Should short and long breaks be persisted in history by default?
7. Does the seven-day report mean a rolling seven-day window or the current
   calendar week?
8. Is localization required for the MVP? If so, which languages?
9. What is the final product name and visual identity?

## 16.2 Technical decisions

1. Application framework and version.
2. Package manager and supported Node.js version.
3. Relational database and hosting provider.
4. ORM or SQL access strategy.
5. Authentication provider.
6. Deployment platform and regions.
7. Unit, integration, and end-to-end testing tools.
8. Runtime schema-validation library.
9. Logging, monitoring, and product-analytics providers.
10. Background-job or scheduled-reconciliation requirements.
11. Whether timer APIs use REST endpoints, server actions, or another boundary.
12. Whether charts require a library or can use lightweight native rendering.

## 16.3 Constraints to confirm

1. Expected MVP budget.
2. Target beta date.
3. Team size and areas of expertise.
4. Expected initial and first-year user counts.
5. Required hosting region or data-residency constraints.
6. Whether the product will initially be free.
7. Whether the repository will be public or private.
8. Whether anonymous product analytics are permitted.

---

# 17. Required engineering artifacts

Before substantial feature implementation, Wayfinder should help create or
confirm:

```text
AGENTS.md
docs/
  agents/
    issue-tracker.md
    triage-labels.md
    domain-docs.md
  product/
    CONTEXT.md
    PRODUCT_SPEC.md
    adr/
      README.md
```

Recommended additional artifacts:

```text
docs/
  architecture/
    SYSTEM_DESIGN.md
  testing/
    TEST_STRATEGY.md
  operations/
    RUNBOOK.md
```

Responsibilities:

- `PRODUCT_SPEC.md` defines product scope and acceptance criteria.
- `CONTEXT.md` gives agents a concise map of the product domain and links to
  authoritative documents.
- ADRs record durable architecture decisions and their trade-offs.
- `SYSTEM_DESIGN.md` describes implementation architecture after approval.
- `TEST_STRATEGY.md` maps risks and requirements to tests.
- `RUNBOOK.md` documents deployment, rollback, migration, and incident tasks.
- `AGENTS.md` tells coding agents how to locate issue tracking, triage labels,
  domain documentation, and repository-specific commands.

---

# 18. Instructions for Wayfinder

Use the following workflow:

1. Read this entire document.
2. Read `AGENTS.md` and files under `docs/agents/` if they exist.
3. Explore the repository before proposing changes.
4. Summarize the destination, settled decisions, exclusions, and risks.
5. Do not repeat questions already answered in this document.
6. Ask only questions whose answers materially affect scope or architecture.
7. Ask questions in small, prioritized groups.
8. Present options, trade-offs, and a recommendation for each decision.
9. Update this specification after product clarification.
10. Create a concise `docs/product/CONTEXT.md` that links back to this file.
11. Propose ADRs for consequential technical decisions.
12. Produce a dependency-aware implementation plan.
13. Convert approved plan items into the configured issue tracker.
14. Define validation and test requirements for every issue.
15. Begin implementation only after the owner approves the destination,
    architecture, and first milestone.

Initial prompt to execute:

> Read `AGENTS.md`, the files under `docs/agents/`, and
> `docs/product/PRODUCT_SPEC.md`. Treat the product specification as a draft
> destination, not as permission to start coding. Explore the repository,
> summarize what is already decided, identify the highest-risk ambiguities,
> and guide me through the remaining product and architecture decisions one
> at a time. Recommend an option for each question and explain its trade-offs.
> Once the destination is approved, update the relevant context documents and
> propose the next workflow step without implementing features prematurely.
