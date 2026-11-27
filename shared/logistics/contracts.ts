/**
 * Logistics Manager API contract shared by the frontend (src/logistics) and the
 * backend (server). Types only: this file must not import anything, so the
 * frontend build never depends on server packages.
 *
 * Conventions:
 * - Identifiers are UUID strings.
 * - Instants are ISO 8601 strings in UTC (`2026-12-02T09:00:00.000Z`).
 * - Local dates are `YYYY-MM-DD`, local times `HH:MM`, interpreted in the
 *   record's IANA time zone (`Atlantic/Canary` by default).
 * - Missing information is `null`, never invented; the UI shows it as
 *   «Pendiente de verificar».
 *
 * Routes (prefix `/api`; all except health and the public auth routes need
 * `Authorization: Bearer <token>`; writes by a `guest` return 403 FORBIDDEN):
 *
 *   GET    /health                               → HealthResponse
 *   GET    /auth/users                           → 404 since E4 (no public list of users)
 *   POST   /auth/login         LoginRequest      → LoginResponse (401, 429)
 *   POST   /auth/logout                          → 204
 *   GET    /me                                   → MeResponse
 *   GET    /organizations/:orgId/events          → ListResponse<LogisticsEvent>
 *          (sorted by date, then startsAt, undated last, then name)
 *   POST   /events             CreateEventInput  → 201 LogisticsEvent
 *   PATCH  /events/:id         UpdateEventInput  → LogisticsEvent (409 VERSION_CONFLICT with `current`)
 *   GET    /organizations/:orgId/venues          → ListResponse<Venue>
 *   GET    /organizations/:orgId/activity?limit= → ListResponse<ActivityEntry> (newest first, default 20, max 100)
 *   DELETE /organizations/:orgId/demo            → {removed: number} (deletes every isDemo record)
 *
 * Milestone 2 (tasks and calendar):
 *
 *   GET    /organizations/:orgId/tasks[?eventId=] → ListResponse<Task>
 *          (all tasks of the organization, or of one event; sorted like events)
 *   POST   /tasks              TaskInput          → 201 Task
 *   PATCH  /tasks/:id          TaskInput          → Task (409 VERSION_CONFLICT with `current`)
 *   DELETE /tasks/:id?version=N                   → 204 (409 VERSION_CONFLICT with `current`);
 *          removes it from other tasks' `dependsOn` (their version increases)
 *   GET    /organizations/:orgId/companies        → ListResponse<Company> (by name, ignoring case)
 *
 * Milestone 3 (contacts and catalogue):
 *
 *   GET    /organizations/:orgId/categories       → ListResponse<Category>
 *          (built-ins in BUILT_IN_SERVICE_CATEGORIES order, then custom by name)
 *   POST   /categories         CategoryInput      → 201 Category; an existing name
 *          (any case) in the same scope returns 200 with that category
 *   DELETE /categories/:id                        → 204; custom only (400 for built-in);
 *          companies and offers lose it (their version increases)
 *   POST   /companies          CompanyInput       → 201 Company (409 DUPLICATE with `current`)
 *   PATCH  /companies/:id      CompanyInput       → Company (409 VERSION_CONFLICT | DUPLICATE)
 *   DELETE /companies/:id?version=N               → 204 (409 VERSION_CONFLICT); deletes
 *          its offers; its contacts and tasks lose the company (versions increase)
 *   GET    /organizations/:orgId/contacts         → ListResponse<Contact> (by name, ignoring case)
 *   POST   /contacts           ContactInput       → 201 Contact
 *   PATCH  /contacts/:id       ContactInput       → Contact (409 VERSION_CONFLICT)
 *   DELETE /contacts/:id?version=N                → 204 (409); tasks lose the contact and
 *          a company that had it as main contact loses it (versions increase)
 *   GET    /organizations/:orgId/offers           → ListResponse<Offer> (by company, then name)
 *   POST   /offers             OfferInput         → 201 Offer
 *   PATCH  /offers/:id         OfferInput         → Offer (409 VERSION_CONFLICT)
 *   DELETE /offers/:id?version=N                  → 204 (409)
 *   GET    /organizations/:orgId/recent-searches  → ListResponse<RecentSearch>
 *          (the current user's, newest first, at most 5)
 *   POST   /organizations/:orgId/recent-searches  RecentSearchInput → ListResponse<RecentSearch>
 *          (403 for guests: a shared login keeps its searches on the device)
 *   DELETE /organizations/:orgId/recent-searches  → 204 (clears the current user's)
 *
 * Milestone 4 (inventories, quick capture, history):
 *
 *   GET    /organizations/:orgId/warehouses       → ListResponse<Warehouse> (by name, ignoring case)
 *   POST   /warehouses         WarehouseInput     → 201 Warehouse (409 DUPLICATE with `current`)
 *   PATCH  /warehouses/:id     WarehouseInput     → Warehouse (409 VERSION_CONFLICT | DUPLICATE)
 *   DELETE /warehouses/:id?version=N              → 204 (409); its resources lose the
 *          warehouse and notes lose the link (versions increase)
 *   GET    /organizations/:orgId/resources        → ListResponse<Resource> (by name, ignoring case)
 *   POST   /resources          ResourceInput      → 201 Resource
 *   PATCH  /resources/:id      ResourceInput      → Resource (409 VERSION_CONFLICT)
 *   DELETE /resources/:id?version=N               → 204 (409); tasks and notes lose it
 *          (versions increase)
 *   GET    /organizations/:orgId/notes            → ListResponse<Note> (newest first)
 *   POST   /notes              NoteInput          → 201 Note
 *   PATCH  /notes/:id          NoteInput          → Note (409 VERSION_CONFLICT)
 *   DELETE /notes/:id?version=N                   → 204 (409)
 *   GET    /organizations/:orgId/activity?entityType=&entityId=&limit=
 *          → ListResponse<ActivityEntry>: the history of one record (newest
 *          first); both parameters or neither (400 otherwise)
 *   DELETE /categories/:id now also unlinks resources (scope `resource`).
 *   Deleting a task, company, contact or offer also unlinks notes that point
 *   at it (versions increase).
 *
 * Milestone 5 (day follow-up, delay hypotheses, work orders):
 *
 *   GET    /organizations/:orgId/hypotheses       → ListResponse<DelayHypothesis> (newest first)
 *   POST   /hypotheses         HypothesisInput    → 201 DelayHypothesis (stored, never applied)
 *   DELETE /hypotheses/:id                        → 204; open hypotheses only (400 once applied)
 *   POST   /hypotheses/:id/apply ApplyHypothesisInput → ApplyHypothesisResponse.
 *          The server recomputes the shift with `simulateDelay` on the current
 *          plan and applies it in one transaction only if it matches
 *          `expected` exactly (same tasks, versions and new times); otherwise
 *          409 VERSION_CONFLICT with `current` = the tasks as they are now, and
 *          nothing changes. Never touches `heavyLoad`, `subsoilReview`,
 *          resources or anything but times (and the root's status when
 *          `markDelayed`). Applying twice → 400.
 *   Deleting a task deletes its open hypotheses; applied ones keep their
 *   label (`taskTitle`) with `taskId` null. Applying logs each moved task as
 *   `update` and the hypothesis as `update` with `changedFields: ['appliedAt']`.
 *   Deleting a resource clears the subsoil mark of the tasks that used it.
 *   `TaskInput.subsoilReviewed` declares or withdraws «Subsuelo revisado en el
 *   simulador» (members only; only on a task with `heavyLoad: true`).
 *   Work orders are built in the browser (`work-order.ts`) from the records the
 *   viewer already received; there is no work-order route.
 *
 * Milestone 6 (offline outbox, cheap refresh, day close):
 *
 *   GET    /organizations/:orgId/changes[?since=<cursor>] → ChangesResponse.
 *          Reads the activity log: which record types were written after
 *          `cursor` (plus any written in the last CHANGES_OVERLAP_SECONDS, so
 *          transactions that commit out of order are never missed). Without
 *          `since`, or with a cursor the server does not recognise (malformed,
 *          ahead of the log), `full: true`: reload everything. Guests read it
 *          too (types only, no labels).
 *   GET    /organizations/:orgId/activity?from=<instant>&to=<instant>[&limit=]
 *          → ListResponse<ActivityEntry> of `from` ≤ at < `to` (newest first,
 *          default and max ACTIVITY_RANGE_MAX, span at most 8 days; both or
 *          neither; not combinable with entityType/entityId → 400).
 *   Create with a device id: POST /events, /tasks, /companies, /contacts,
 *          /offers, /warehouses, /resources and /notes accept an optional
 *          `id` (a UUID generated on the device, so a queued create can be
 *          replayed safely and other queued writes can point at it). If a
 *          record of that type with that id already exists in the same
 *          organization and was created by the same user, the answer is 200
 *          with the record as it is now (a replay: nothing changes, no
 *          activity). Any other existing use of the id → 400 `fields.id`.
 *   The day close is built in the browser (`day-report.ts`) from the records
 *   the viewer already received plus that day's activity; there is no
 *   report route.
 *
 * Revisión 1 · E2 (tasks and conflicts; migration 0007):
 *
 *   PATCH  /venues/:id         VenueInput         → Venue (409 VERSION_CONFLICT | DUPLICATE)
 *          name, acronym and opening hours (members only)
 *   WarehouseInput also takes `acronym` and `openingHours`.
 *   Acronym: `acronymProblem` (acronym.ts) → 400 `fields.acronym`; blank = null.
 *   Opening hours: `openingHoursProblem` (move.ts) → 400 `fields.openingHours`.
 *   PATCH  /organizations/:orgId OrganizationInput → Organization (members only;
 *          409 VERSION_CONFLICT with `current`); logged as entityType
 *          `organization` (the device refreshes GET /me when `/changes`
 *          reports it).
 *   POST   /tasks/:id/move     MoveTaskInput      → MoveTaskResponse. The server
 *          recomputes the move with `simulateMove` (move.ts `moveItems`) on
 *          the current plan under the graph lock and the task row locks, and
 *          writes it only if it matches `expected` exactly; otherwise 409
 *          VERSION_CONFLICT with `current` = the organization's involved
 *          tasks as they are now. Only times and local days change (never
 *          status, heavy load, subsoil review, venue or resources). Each moved
 *          task is logged as `update` with the fields that changed
 *          (`startsAt`, `endsAt`, and `date` / `endDate` when the day changes)
 *          and `origin`. A task done, cancelled, under way or without times
 *          → 400 `fields.minutes` (`MOVE_BLOCKED`). A move whose task ends up
 *          outside its venue's known opening hours → 400 `fields.minutes`
 *          (`outsideHoursMessage`); dependants pushed out of hours are only
 *          shown by `analyzeMove`.
 *          «Deshacer»: origin `undo` with `expected` = every task the move
 *          changed, with the version it has now and the window it had
 *          before. Written only if every version still matches and each
 *          window keeps its duration (409 otherwise); no opening-hours check
 *          (it goes back to where it was).
 *   GET    /organizations/:orgId/conflict-acceptances → ListResponse<ConflictAcceptance>
 *          (newest first; `reason` null for guests)
 *   POST   /conflict-acceptances ConflictAcceptanceInput → 201 ConflictAcceptance
 *          (members only). Only conflicts (`isAcceptable`), never reminders
 *          → 400 `fields.warningKey`. The warning must exist on the current
 *          plan (`planWarnings`) with exactly those windows, else 409
 *          VERSION_CONFLICT with `current` = the involved tasks as they are
 *          now. An acceptance of the same warning that still applies → 409
 *          DUPLICATE with `current` = that acceptance. Reason trimmed,
 *          ACCEPT_REASON_MIN–ACCEPT_REASON_MAX → 400 `fields.reason`.
 *   DELETE /conflict-acceptances/:id               → 204 (members only; withdraw)
 *   Acceptances are logged as entityType `conflict_acceptance` (label: the
 *   warning title). Removing the demo removes acceptances of demo tasks.
 *
 * Revisión 1 · E3 (answers and images; migration 0008):
 *
 *   GET    /notes/:id/answers                     → ListResponse<NoteAnswer> (newest first;
 *          `text` null for guests)
 *   POST   /notes/:id/answers  NoteAnswerInput    → 201 NoteAnswer. Open questions
 *          only (400 otherwise). `replaces` must name the current answer when
 *          there is one, and be null when there is none (409 VERSION_CONFLICT
 *          with `current` = the current answer, or null). Closed questions
 *          (`resolved`) → 400. Guests → 403. Text 1–NOTE_TEXT_MAX → 400
 *          `fields.text`. The note's version increases (its `answer`
 *          changed) and it is logged as a note `update` with `changedFields`
 *          ['answer'].
 *   Marking an open question `resolved` (or reopening it) is allowed only to
 *          its author, or to any member while it has no current answer
 *          (403 FORBIDDEN otherwise). `resolvedBy` / `resolvedAt` are set
 *          for every kind when it becomes resolved and cleared when reopened.
 *          A resolved open question takes no answers. A question with
 *          answers cannot change kind (400 `fields.kind`).
 *   POST   /media              MediaUploadInput   → 201 MediaInfo (members only;
 *          JPEG / PNG / WebP, at most MEDIA_MAX_BYTES; attached to one record;
 *          the bytes must be that type and the declared size, each side
 *          1–MEDIA_MAX_SIDE → 400 `fields.data` / `fields.width`…; at most
 *          MEDIA_PER_RECORD per record → 400 `fields.ownerId`). The first
 *          image of a record is always main; `main: true` takes the mark
 *          from the current one. Device `id` replay as for other creates.
 *          This body may be up to 1 MB (others: 100 KB). `ownerType: 'user'`
 *          is the profile photo (E4, below). Logged as a resource `update` with
 *          `changedFields` ['media'] (the resource's version does not change).
 *   GET    /media/:id                              → the image bytes (authenticated,
 *          guests too; `Cache-Control: private, max-age=31536000, immutable`)
 *   DELETE /media/:id                              → 204 (members only); deleting the
 *          main image makes the oldest remaining one main
 *   PATCH  /media/:id          {main: true}       → MediaInfo (makes it the main image)
 *   Resource gains `media: MediaInfo[]` (main first, then oldest first).
 *          Deleting a resource deletes its media.
 *
 * Revisión 1 · E4 (roles and access; migration 0009):
 *
 *   Roles per membership add up (`OrgRole`); `permissions.ts` maps them to
 *   permissions. `Organization.roles` / `.permissions` (GET /me, login) are
 *   the viewer's effective ones; the server enforces them:
 *   - writes need `plan.edit` (403 otherwise; account routes excepted);
 *   - contacts, companies, offers and their history need `directory.read`
 *     (403); categories without it list only the `resource` scope; the
 *     activity feed leaves out contact, company and offer entries; a task's
 *     `contact` is withheld from guests (its company name stays);
 *   - while `passwordProvisional`, SENSITIVE_PERMISSIONS are withheld (403
 *     FORBIDDEN on their routes; the UI asks for a new password).
 *   Public (no token):
 *   POST   /auth/login         LoginRequest      → LoginResponse. `username` any case
 *          (`displayName` accepted for one release); same 401 for an unknown
 *          user or a wrong password, same timing; 429 by name and by IP.
 *   POST   /auth/recovery      RecoveryRequest   → 202 always, same body whether
 *          the account exists or not. A single-use link (RESET_LINK_MINUTES)
 *          goes to the verified recovery e-mail, else to the project inbox
 *          (server setting, never revealed). Never for the guest account.
 *          Rate limited by name and IP (429).
 *   POST   /auth/reset         PasswordResetInput → 204; the link is spent; every
 *          session of the account ends. Unknown, used or expired link → 400
 *          `fields.token`; weak password → 400 `fields.newPassword`.
 *   POST   /auth/verify-email  EmailVerifyInput  → 204 (the address becomes the
 *          recovery e-mail); unknown, used or expired → 400 `fields.token`.
 *   Own account (blocked during a support session, except GET /me):
 *   GET    /me/profile                           → Profile
 *   PATCH  /me/profile         ProfileInput      → Profile (409 VERSION_CONFLICT | DUPLICATE).
 *          Shared accounts (`Profile.sharedAccount`: Equipo, Invitado) cannot
 *          change their `displayName` → 403 FORBIDDEN (sending the current
 *          name unchanged is fine); administration renames them.
 *   POST   /me/password        PasswordChangeInput → 204 (wrong current → 400
 *          `fields.currentPassword`, 429 after repeated failures); clears
 *          `passwordProvisional`; `signOutOthers` ends the other sessions.
 *          Shared accounts → 403 FORBIDDEN (administration or development
 *          sets their password; they are never `passwordProvisional`).
 *   POST   /me/email           RecoveryEmailInput → 202: a verification link
 *          (EMAIL_LINK_HOURS) is sent to that address; the current one stays
 *          until it is verified. Shared accounts → 403.
 *   DELETE /me/email                             → 204 (no recovery e-mail)
 *   POST   /me/welcome                           → 204 (`welcomed` = true)
 *   GET    /me/sessions                          → ListResponse<SessionInfo> (newest first)
 *   DELETE /me/sessions/:id                      → 204 (own sessions; also ends a
 *          support session opened on this account)
 *   DELETE /me/sessions                          → 204 (every session but this one)
 *   GET    /me/security                          → ListResponse<SecurityEvent>
 *          (own, newest first, at most 100)
 *   Profile photo: POST /media with `ownerType: 'user'` and `ownerId` = own id
 *          (only the owner; replaces the previous one; not for the guest
 *          account; not during a support session). Logged in the security
 *          log as `profile_changed`, not in the activity feed.
 *          GET /media/:id of a profile photo: members only (404 for guests).
 *   GET    /organizations/:orgId/members         → ListResponse<MemberProfile>
 *   Administration (`users.manage` unless stated; never during a support session):
 *   GET    /admin/users                          → ListResponse<AdminUser>
 *          (people of the organizations the caller manages)
 *   PUT    /admin/users/:id/roles AdminRolesInput → AdminUser (role `admin` in that
 *          organization; at least one administrator must remain → 400
 *          `fields.roles`; the guest account has no roles → 400)
 *   POST   /admin/users/:id/provisional-password → ProvisionalPasswordResponse
 *          (shown once; never the current one; any account but one's own;
 *          every session of that account ends; for a shared account it is
 *          its password, not provisional)
 *   PATCH  /admin/users/:id/profile AdminProfileInput → AdminUser: name and
 *          photo of a shared account (`AdminUser.sharedAccount`). A personal
 *          account → 403 FORBIDDEN (each person edits their own profile);
 *          stale `version` → 409 VERSION_CONFLICT (`current`: AdminUser); name taken → 409 DUPLICATE `fields.displayName`; a
 *          photo for the guest account → 400 `fields.photo`; a bad image →
 *          400 on `photo`'s fields as for POST /media. `photo: null` removes
 *          it. Body up to 1 MB. Logged as `profile_changed` with the actor.
 *   POST   /admin/users/:id/reset-link           → ResetLinkResponse when no mail
 *          transport is configured, else 202 and the link is e-mailed
 *   POST   /admin/support-sessions SupportSessionInput → 201 SupportSessionResponse
 *          (`support.start`; wrong password → 400 `fields.password`, 429;
 *          not on oneself nor the guest account; the account's owner sees it
 *          in GET /me/security and GET /me/sessions)
 *   POST   /admin/view-as-guest ViewAsGuestInput → 201 SupportSessionResponse
 *          (`view_as_guest`; VIEW_AS_GUEST_MINUTES; the session is the guest
 *          account's: same withholding, read-only)
 *   GET    /admin/support-sessions               → ListResponse<SupportSession> (open ones)
 *   DELETE /admin/support-sessions/:id           → 204 (who opened it or, for
 *          support, the account's owner; any session token of theirs)
 *   GET    /admin/security                       → ListResponse<SecurityEvent>
 *          (accounts of the managed organizations, newest first, at most 200)
 *   Logout of a support or «Ver como Invitado» session ends it (logged).
 *
 * Revisión 1 · E5 (taxes and budget; migration 0010):
 *
 *   Taxes: CompanyInput and OfferInput take `tax` (TaxInput | null); Company
 *   carries `tax`, Offer carries `tax` (own; null = inherits) and
 *   `companyTax`. `normalizeTax` (money.ts) → 400 `fields['tax.regime']`,
 *   `fields['tax.name']`, `fields['tax.ratePercent']`. Existing offers keep
 *   their `vatIncluded` and get no tax (null): no percentage is invented. A
 *   new offer without `vatIncluded` is before tax (false). Offer `tax` and
 *   `companyTax` are withheld from guests with the prices (guests have no
 *   Catálogo anyway).
 *   Budget routes need `budget.read` (reads) or `budget.edit` (writes): 403
 *   FORBIDDEN otherwise (guests, the team role, a provisional password with
 *   PROVISIONAL_HOLD); an event or expense of another organization → 404.
 *   GET    /events/:id/budget                      → EventBudgetResponse
 *   PUT    /events/:id/budget  EventBudgetInput    → EventBudget (409 VERSION_CONFLICT
 *          with `current`; version 0 = not set yet)
 *   POST   /expenses           ExpenseInput        → 201 Expense (device `id` replay → 200)
 *   PATCH  /expenses/:id       ExpenseInput        → Expense (409 VERSION_CONFLICT)
 *   DELETE /expenses/:id?version=N                 → 204 (409)
 *   GET    /organizations/:orgId/budgets           → ListResponse<BudgetSummary>
 *          (events with a budget or an expense, sorted like events)
 *   Concept 1–NAME_MAX, notes up to NOTES_MAX, amounts like offer prices,
 *   at most MAX_EXPENSES_PER_EVENT per event (400 `fields.eventId`).
 *   Logged as entityType `budget` (entityId = the event, label = the event
 *   name) and `expense` (label = its concept), field names only: amounts
 *   never reach the activity log. Viewers without `budget.read` never get
 *   those entries (activity, history → 403) nor those types in `/changes`.
 *   The device never stores budget data nor queues budget writes (outbox).
 *   Deleting an event (demo removal) deletes its budget and expenses.
 *   Deleting a company keeps its expenses: they lose the link (`company.id`
 *   null, its name kept; version increases, logged as `expense` update
 *   ['company']); a demo company used by a real expense survives the demo
 *   removal. Deleting or editing an offer never touches an expense snapshot.
 *
 * Revisión 1 · E6–E7 (offer terms, quote requests, proposals; migration 0011):
 *
 *   Reads and requests need `directory.read` (administrators, developers,
 *   the team); deciding, settings and renewals need `offers.approve`
 *   (administrators). Guests → 403; a provisional password → 403
 *   PROVISIONAL_HOLD; a record of another organization → 404.
 *   GET    /offers/:id/versions                     → ListResponse<OfferVersion> (newest first)
 *   GET    /organizations/:orgId/offer-versions     → ListResponse<OfferVersion>
 *          (the version in force of every offer that has one; offers without
 *          versions: `legacyTerms`. Compare with `compareNeed`: expired ones
 *          are never ranked)
 *   GET    /organizations/:orgId/offer-settings     → OfferSettings (defaults, version 0)
 *   PATCH  /organizations/:orgId/offer-settings  OfferSettingsInput
 *                                                   → OfferSettingsResponse (409 with `current`;
 *          `openLinkUrl` only when this change issued an open link)
 *   GET    /organizations/:orgId/offer-renewals     → ListResponse<OfferRenewal> (deadline first)
 *   POST   /organizations/:orgId/offer-renewals/run → {created} (also every hour and at start)
 *   PATCH  /offer-renewals/:id  OfferRenewalInput   → OfferRenewal (400 `fields.assigneeId`; 409)
 *   GET    /organizations/:orgId/quote-requests     → ListResponse<QuoteRequest> (newest first)
 *   POST   /quote-requests  QuoteRequestInput       → 201 QuoteRequestCreated (the only time
 *          the link addresses exist; the UI prepares a mailto, the server never
 *          writes to companies; 400 without a browser Origin to build them)
 *   POST   /quote-requests/:id/links  QuoteLinksInput → QuoteRequestCreated (a company that
 *          already answered → 400 `fields.companyIds`)
 *   POST   /quote-requests/:id/links/:linkId/renew  {linkDays?} → QuoteRequestCreated
 *          (same link, new address; the old one stops working)
 *   POST   /quote-requests/:id/close  {version}     → QuoteRequest (waiting links → revoked; 409)
 *   GET    /organizations/:orgId/proposals?state=pending|approved|rejected → ListResponse<Proposal>
 *   GET    /proposals/:id                           → Proposal
 *   POST   /proposals  ManualProposalInput          → 201 Proposal (recorded by hand)
 *   POST   /proposals/:id/approve  ProposalApproveInput → ProposalApproveResponse
 *          (company found or created by name; its tax set «por verificar» when
 *          it had none, else a different stated tax becomes the offer's own;
 *          each product → a new offer with version 1, or a new version of an
 *          offer of the same company (an offer without versions first gets
 *          version 1 from its catalogue data); expired → 400; 409)
 *   POST   /proposals/:id/reject  ProposalRejectInput → Proposal (reason required; 409)
 *   Public supplier routes, WITHOUT a session. The token is the credential
 *   and travels in the JSON body as `token` (the UI reads it from the link's
 *   `#…` fragment, like the account links), never in the address. Rate
 *   limited per address and per link, bodies up to PROPOSAL_BODY_MAX_BYTES,
 *   `privacyAccepted` must be true; an unknown, expired, replaced, closed or
 *   missing token → the same 404 body; whatever arrives is a pending
 *   proposal, never shown to another company:
 *   POST   /public/requests/lookup  {token}         → PublicQuoteRequest
 *   POST   /public/requests/proposal  ProposalInput & {token} → 201 PublicProposalReceipt
 *          (one per link: then 400)
 *   POST   /public/requests/decline  SupplierDeclineInput & {token} → 204
 *   POST   /public/offers/lookup  {token}           → PublicOpenForm (only while enabled)
 *   POST   /public/offers/proposal  ProposalInput & {token} → 201 PublicProposalReceipt
 *   Logged as entityType `quote_request`, `proposal` (public ones signed by
 *   «Sistema»), `offer_settings`, `offer_renewal`, plus `offer`, `company`,
 *   `contact` and `task` for what an approval or a renewal writes; all are
 *   directory types (hidden without `directory.read`). Renegotiation tasks
 *   are ordinary tasks without event written by «Sistema»; their
 *   `OfferRenewal` is the «Generada por Ox Eye» mark.
 *
 * Guests (role `guest`, a shared login) never receive contact details,
 * prices or free-text observations: the server sends those fields as null and
 * sets `restricted: true`, and the UI shows «Visible para el equipo» instead
 * of «Pendiente de verificar». Withheld today: people's phone, e-mail,
 * description and notes; companies' phone, e-mail and notes; offers' prices,
 * costs, conditions and taxes (E5); events' and tasks' notes (M4); warehouses' address
 * and notes; resources' location and notes; the text of every note; the note
 * of a delay hypothesis (M5); the text of an answer (also inside
 * `Note.answer`) and the reason of an accepted conflict (Revisión 1); a
 * task's contact person (E4: guests have no Contactos at all). Guests do see
 * material photos, not people's profile photos. `WITHHELD_FROM_GUESTS` in
 * `shared/logistics/redaction.ts` is the single list (M6: the server and the
 * device cache both apply it).
 */

export type Uuid = string;
export type IsoInstant = string;
export type LocalDate = string;
export type LocalTime = string;

/** Where a piece of information came from. */
export type DataSource = 'observed' | 'reported' | 'document';
/** How trustworthy a record is. */
export type Verification = 'draft' | 'to_verify' | 'validated';

export interface UserRef {
  id: Uuid;
  displayName: string;
}

/** Fields carried by every mutable record. */
export interface RecordMeta {
  id: Uuid;
  /** Optimistic concurrency counter; send it back on update. */
  version: number;
  createdBy: UserRef;
  createdAt: IsoInstant;
  updatedBy: UserRef;
  updatedAt: IsoInstant;
  source: DataSource | null;
  verification: Verification;
  /** Fictitious demo data, removable in one action. */
  isDemo: boolean;
}

/** Common optional input for records that carry provenance. */
export interface ProvenanceInput {
  source?: DataSource | null;
  verification?: Verification;
}

// ---------------------------------------------------------------- auth

/**
 * Account kind, unchanged since M1: `guest` is the shared read-only account
 * («Invitado»); every other account is a `member`. What a member may do in
 * an organization comes from its roles there (`OrgRole`, E4), which add up.
 */
export type Role = 'member' | 'guest';

/** E4: roles of a membership; permissions in `permissions.ts` (`ROLE_PERMISSIONS`). */
export type OrgRole = 'admin' | 'developer' | 'team';

export type Permission =
  /** Create, edit and delete plan records (events, tasks, notes, inventory…). */
  | 'plan.edit'
  /** Contactos and Catálogo (contacts, companies, offers, service categories). */
  | 'directory.read'
  /** Event budget and expenses (E5). */
  | 'budget.read'
  | 'budget.edit'
  /** Approve or reject offers received from suppliers (E6/E7). */
  | 'offers.approve'
  /** Users panel: provisional passwords, reset links, sessions, security log. */
  | 'users.manage'
  /** Start a support session on another member's account. */
  | 'support.start'
  /** «Ver como Invitado». */
  | 'view_as_guest'
  /** Technical diagnosis (server details). */
  | 'diagnostics.read';

/** E4: a support session or «Ver como Invitado» in progress (banner). */
export interface SupportInfo {
  kind: 'support' | 'view_as_guest';
  /** Who opened it (the administrator). */
  by: UserRef;
  /** Reason given for a support session; null for «Ver como Invitado». */
  reason: string | null;
  endsAt: IsoInstant;
}

export interface SessionUser {
  id: Uuid;
  /** E4: login name (today's display name for existing accounts); never changes. */
  username: string;
  /** E4: editable in the profile. */
  displayName: string;
  role: Role;
  /** E4: profile photo (`MediaInfo.id`, owner type `user`); null when none. */
  avatarId: Uuid | null;
  /** E4: accent colour key chosen in the profile; null = the palette's own. */
  accent: string | null;
  /**
   * E4: the password was set by someone else (initial or provisional). While
   * true the sensitive permissions are withheld (`SENSITIVE_PERMISSIONS`).
   * Always false for the guest account (it cannot change its password).
   */
  passwordProvisional: boolean;
  /** E4: the first-login welcome was seen (POST /me/welcome). */
  welcomed: boolean;
  /** E4: set while this session is a support session or «Ver como Invitado». */
  support: SupportInfo | null;
}

export interface Organization {
  id: Uuid;
  name: string;
  timezone: string;
  /**
   * Short form for file names and compact labels («SCLL»), as edited (E2).
   * Null = not set; the UI proposes one with `proposeAcronym`.
   */
  acronym: string | null;
  /** Optimistic concurrency counter (E2). */
  version: number;
  /** E4: the viewer's roles here (always empty for the guest account). */
  roles: OrgRole[];
  /**
   * E4: what the viewer may do here: roles, minus the sensitive permissions
   * while the password is provisional, minus account administration during
   * a support session (`effectivePermissions`). The server enforces it.
   */
  permissions: Permission[];
}

/** E2: only the acronym is editable from the Gestor. */
export interface OrganizationInput {
  /** 1–ACRONYM_MAX letters, digits or dots; null clears it. */
  acronym?: string | null;
  version: number;
}

/**
 * A daily opening window in the place's time zone (E2). `opensAt` < `closesAt`
 * (no overnight windows). Null on a record = not known («Pendiente de
 * verificar»): nothing is limited.
 */
export interface OpeningHours {
  opensAt: LocalTime;
  closesAt: LocalTime;
}

/**
 * @deprecated E4 removed `GET /auth/users` (404): the login screen asks for
 * the username. Kept only until the E4 login screen replaces the list.
 */
export interface LoginUserOption {
  displayName: string;
  role: Role;
}

export interface LoginRequest {
  /** E4: login name, any letter case. */
  username: string;
  password: string;
  /** @deprecated accepted instead of `username` for one release (pre-E4 clients). */
  displayName?: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: IsoInstant;
  user: SessionUser;
  organizations: Organization[];
}

export interface MeResponse {
  user: SessionUser;
  organizations: Organization[];
}

// ---------------------------------------------------------------- account and administration (E4)

/** Update of the own profile; only the fields sent change. */
export interface ProfileInput {
  /** 1–80 characters; unique (any case) → 409 DUPLICATE. */
  displayName?: string;
  /** Short description, at most BIO_MAX characters; blank = null. */
  bio?: string | null;
  /** `^[a-z][a-z0-9-]{0,31}$` (a key the app offers); null = palette default. */
  accent?: string | null;
  version: number;
}

/** GET /me/profile: the private part of the own account. */
export interface Profile {
  user: SessionUser;
  bio: string | null;
  /** The verified recovery address, masked («y•••@example.com»); null when none. */
  recoveryEmail: string | null;
  /** An address waiting for its verification link, masked; null when none. */
  pendingRecoveryEmail: string | null;
  /**
   * Shared account (guest, or a member with only the `team` role): no
   * recovery e-mail, its password is set by an administrator or developer.
   */
  sharedAccount: boolean;
  version: number;
}

export interface PasswordChangeInput {
  currentPassword: string;
  /** PASSWORD_MIN–PASSWORD_MAX characters, not the username (`passwordProblem`). */
  newPassword: string;
  /** Also close every other session of this account. */
  signOutOthers?: boolean;
}

export interface RecoveryEmailInput {
  email: string;
}

export interface RecoveryRequest {
  username: string;
}

export interface PasswordResetInput {
  token: string;
  newPassword: string;
}

export interface EmailVerifyInput {
  token: string;
}

export type SessionKind = 'normal' | 'support' | 'view_as_guest';

export interface SessionInfo {
  id: Uuid;
  /** The session making this request. */
  current: boolean;
  createdAt: IsoInstant;
  lastSeenAt: IsoInstant;
  expiresAt: IsoInstant;
  /** «Chrome · Windows» from the user agent, never the full string. */
  device: string | null;
  kind: SessionKind;
  /** Who opened a support session on this account; null for normal ones. */
  openedBy: UserRef | null;
}

export type SecurityEventKind =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'password_changed'
  | 'password_provisional_set'
  | 'recovery_requested'
  | 'reset_link_created'
  | 'password_reset'
  | 'email_requested'
  | 'email_verified'
  | 'email_removed'
  | 'sessions_revoked'
  | 'support_started'
  | 'support_ended'
  | 'view_as_guest'
  | 'roles_changed'
  | 'profile_changed';

/** Never carries a password, token, hash or e-mail address. */
export interface SecurityEvent {
  id: Uuid;
  kind: SecurityEventKind;
  /** The account it happened to. */
  user: UserRef;
  /** Who did it when it was someone else (administrator); null otherwise. */
  actor: UserRef | null;
  at: IsoInstant;
  /** Reason of a support session; nothing else free-text. */
  detail: string | null;
  /** Device label of the session involved, when known. */
  device: string | null;
}

/**
 * GET /organizations/:orgId/members: people of the organization, so names
 * and photos look the same in assignments, comments and history. For the
 * guest account `avatarId` and `bio` are null (`restricted`).
 */
export interface MemberProfile {
  id: Uuid;
  displayName: string;
  role: Role;
  avatarId: Uuid | null;
  accent: string | null;
  bio: string | null;
  roles: OrgRole[];
  restricted: boolean;
}

export interface AdminUser {
  id: Uuid;
  username: string;
  displayName: string;
  role: Role;
  avatarId: Uuid | null;
  /** Only the organizations the administrator manages. */
  memberships: {organizationId: Uuid; roles: OrgRole[]}[];
  passwordProvisional: boolean;
  hasRecoveryEmail: boolean;
  lastLoginAt: IsoInstant | null;
  openSessions: number;
  /**
   * Equipo, Invitado (`isSharedAccount` over all its organizations): its
   * name, photo and password are set from administration, never by itself.
   */
  sharedAccount: boolean;
  /** The account's version, for PATCH /admin/users/:id/profile. */
  version: number;
}

/** PATCH /admin/users/:id/profile (shared accounts only). */
export interface AdminProfileInput {
  version: number;
  /** 1–DISPLAY_NAME_MAX characters, unique (case-insensitive). */
  displayName?: string;
  /** A new photo (replaces the current one), or null to remove it. */
  photo?: {
    contentType: MediaInfo['contentType'];
    width: number;
    height: number;
    /** Base64 without prefix, as in MediaUploadInput. */
    data: string;
  } | null;
}

export interface AdminRolesInput {
  organizationId: Uuid;
  roles: OrgRole[];
}

/** Shown once; never stored in clear, never sent again. */
export interface ProvisionalPasswordResponse {
  password: string;
}

/** POST /admin/users/:id/reset-link without a mail transport. */
export interface ResetLinkResponse {
  url: string;
  expiresAt: IsoInstant;
}

export interface SupportSessionInput {
  userId: Uuid;
  /** SUPPORT_REASON_MIN–SUPPORT_REASON_MAX characters. */
  reason: string;
  /** The administrator's own password (re-authentication). */
  password: string;
  /** SUPPORT_MINUTES_MIN–SUPPORT_MINUTES_MAX. */
  minutes: number;
}

export interface ViewAsGuestInput {
  /** The organization whose guest account to see; default: the first allowed. */
  organizationId?: Uuid;
}

/**
 * A new support or «Ver como Invitado» session: the client keeps its own
 * token aside and uses this one until it ends (logout or DELETE).
 */
export interface SupportSessionResponse extends LoginResponse {
  sessionId: Uuid;
}

export interface SupportSession {
  id: Uuid;
  kind: 'support' | 'view_as_guest';
  /** The account it acts as (the guest account for «Ver como Invitado»). */
  user: UserRef;
  by: UserRef;
  reason: string | null;
  startedAt: IsoInstant;
  endsAt: IsoInstant;
}

// ---------------------------------------------------------------- venues and events

export interface Venue extends RecordMeta {
  organizationId: Uuid;
  name: string;
  address: string | null;
  /** E2: as edited; null = not set (the UI proposes one). */
  acronym: string | null;
  /** E2: null = not known; moves on the calendar are limited only when set. */
  openingHours: OpeningHours | null;
}

/** E2. Update only: `version` required; only the fields sent change. */
export interface VenueInput extends ProvenanceInput {
  name?: string;
  acronym?: string | null;
  openingHours?: OpeningHours | null;
  version: number;
}

export type EventStatus = 'planned' | 'confirmed' | 'delayed' | 'cancelled';

export interface LogisticsEvent extends RecordMeta {
  organizationId: Uuid;
  name: string;
  venue: {id: Uuid; name: string} | null;
  /** Local day in `timezone`; kept even when the times are still unknown. */
  date: LocalDate | null;
  /**
   * Last local day for events spanning several days (fairs, multi-day
   * set-ups); `null` = same day (or the next one for an overnight end time).
   */
  endDate: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  timezone: string;
  status: EventStatus;
  /** Null for guests (`restricted`). */
  notes: string | null;
  /** True when the notes were withheld for this viewer (M4). */
  restricted: boolean;
}

/**
 * Creating an event needs only a name. Date and times are local to the
 * organization's time zone; the server converts them to UTC instants.
 * `venueName` finds or creates a venue of the same organization by name.
 */
export interface CreateEventInput extends ProvenanceInput, DeviceIdInput {
  organizationId: Uuid;
  name: string;
  venueName?: string | null;
  date?: LocalDate | null;
  /** Must be after `date`; requires `date`. */
  endDate?: LocalDate | null;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
  status?: EventStatus;
  notes?: string | null;
}

export interface UpdateEventInput extends ProvenanceInput {
  version: number;
  name?: string;
  venueName?: string | null;
  date?: LocalDate | null;
  endDate?: LocalDate | null;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
  status?: EventStatus;
  notes?: string | null;
}

export interface ListResponse<T> {
  items: T[];
}

/**
 * M6: an optional UUID generated on the device for a create, so an offline
 * create can be replayed without duplicating the record (see the route table).
 */
export interface DeviceIdInput {
  id?: Uuid;
}

/** M6 `GET /organizations/:orgId/changes`. */
export interface ChangesResponse {
  /** Opaque; send it back as `since` on the next poll. */
  cursor: string;
  /**
   * Activity `entityType` values written since the cursor (event, task,
   * venue, company, contact, offer, category, warehouse, resource, note,
   * hypothesis, demo; Revisión 1: organization, conflict_acceptance; E5,
   * only with `budget.read`: budget, expense).
   * Empty = nothing changed.
   */
  types: string[];
  /** True when the client must reload every list (no or unknown cursor). */
  full: boolean;
}

// ---------------------------------------------------------------- activity

export type ActivityAction = 'create' | 'update' | 'delete';

/**
 * `entityType` values: event, task, venue, company, contact, offer,
 * category, warehouse, resource, note, hypothesis (M5), organization and
 * conflict_acceptance (Revisión 1) (and `demo` for the removal itself);
 * E5, only for viewers with `budget.read`: budget (label: the event name)
 * and expense (label: its concept; never an amount).
 * `entityLabel` is a name, never free text: a note's label
 * is its kind and what it points at (`noteLabel` in history.ts); a
 * hypothesis's is `hypothesisLabel` (never its note).
 */
export interface ActivityEntry {
  id: string;
  user: UserRef;
  entityType: string;
  entityId: Uuid;
  /** Human label of the entity at the time of the change (e.g. event name). */
  entityLabel: string;
  action: ActivityAction;
  /** Field names that changed (update only). */
  changedFields: string[];
  at: IsoInstant;
  /** E2: present on task updates written by a move (POST /tasks/:id/move). */
  origin?: MoveOrigin;
  /**
   * Safety audit: present when the change was made in a support session on
   * `user`'s account; the administrator behind it («Dailos (soporte:
   * Elvis)», `signatureLabel` in history.ts). Absent for entries written
   * before migration 0012.
   */
  supportBy?: UserRef;
}

// ================================================================ milestones 2–6
// Routes for these types are added to the header table when each milestone
// starts. Shapes below are the agreed contract.

// ---------------------------------------------------------------- tasks (M2)

export type TaskKind =
  'assembly' | 'activity' | 'dismantling' | 'transport' | 'delivery' | 'other';
export type TaskStatus =
  'planned' | 'confirmed' | 'in_progress' | 'done' | 'delayed' | 'cancelled';

export interface Task extends RecordMeta {
  organizationId: Uuid;
  /** Optional: a task can stand alone (e.g. collect fences from the warehouse). */
  eventId: Uuid | null;
  venue: {id: Uuid; name: string} | null;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  /** Local day in `timezone`; kept even when the times are still unknown. */
  date: LocalDate | null;
  /** Last local day for multi-day tasks; `null` = same day (or overnight). */
  endDate: LocalDate | null;
  startsAt: IsoInstant | null;
  endsAt: IsoInstant | null;
  timezone: string;
  company: {id: Uuid; name: string} | null;
  /** Person to call about this task (milestone 3). */
  contact: {id: Uuid; name: string} | null;
  /** Finish-to-start predecessors. */
  dependsOn: Uuid[];
  /**
   * Involves heavy loads (stage, generator, tank, ballast): the subsoil check
   * must be run in the simulator. `null` = not yet known, never assumed light.
   */
  heavyLoad: boolean | null;
  /**
   * Inventory resources this task uses (M4): the same resource in two live
   * tasks at the same time is a plan warning. Never answers `heavyLoad`.
   */
  resourceIds: Uuid[];
  /**
   * «Subsuelo revisado en el simulador» (M5): a mark a member declares after
   * running the simulator's X-ray check. Declared, never inferred (not from
   * quantities, units or dimensions) and never a certification. The server
   * clears it when the venue, `heavyLoad` or `resourceIds` change, because
   * the review was for that placement and that material.
   */
  subsoilReview: SubsoilReview | null;
  /** Null for guests (`restricted`). */
  notes: string | null;
  /** True when the notes were withheld for this viewer (M4). */
  restricted: boolean;
}

export interface SubsoilReview {
  by: UserRef;
  at: IsoInstant;
}

/**
 * Create: `organizationId` and `title` required; everything else optional.
 * Update: `version` required; only the fields sent change.
 * `venueName` / `companyName` find or create by name (case-insensitive) in the
 * same organization; `companyId` wins over `companyName` when both are sent.
 * `dependsOn` replaces the whole list: same-organization tasks only, no self
 * reference, no cycles (400 VALIDATION with `fields.dependsOn`).
 * Times without `date` are rejected; `endDate` must be after `date`.
 * `kind` defaults to `other`. Moving `date` onto or past a stored `endDate`
 * is a 400: send `endDate` too (or null) when moving a multi-day record.
 * Clearing `date` clears `endDate`. Same rules for events.
 */
export interface TaskInput extends ProvenanceInput, DeviceIdInput {
  organizationId?: Uuid;
  eventId?: Uuid | null;
  venueName?: string | null;
  title?: string;
  kind?: TaskKind;
  status?: TaskStatus;
  date?: LocalDate | null;
  endDate?: LocalDate | null;
  startTime?: LocalTime | null;
  endTime?: LocalTime | null;
  companyId?: Uuid | null;
  companyName?: string | null;
  /**
   * A contact of the same organization (any company: the UI suggests the
   * task company's people first). Unknown or foreign id → 400.
   */
  contactId?: Uuid | null;
  dependsOn?: Uuid[];
  heavyLoad?: boolean | null;
  /**
   * Replaces the whole list (M4): resources of the same organization, at most
   * MAX_RESOURCES_PER_TASK; unknown or foreign id → 400 `fields.resourceIds`.
   */
  resourceIds?: Uuid[];
  /**
   * M5: `true` declares «Subsuelo revisado en el simulador» as the current
   * user now; `false` withdraws it. Only with `heavyLoad: true` (stored or
   * sent in the same request), otherwise 400 `fields.subsoilReviewed`.
   * Changing venue, `heavyLoad` or `resourceIds` clears the mark unless the
   * same request sends `true`.
   */
  subsoilReviewed?: boolean;
  notes?: string | null;
  /** Required on update. */
  version?: number;
}

/**
 * `shift`: the task starts (and ends) later. `extend`: it has started and
 * ends later («se alarga»); its start does not move.
 */
export type DelayMode = 'shift' | 'extend';

/**
 * A stored «¿y si…?» scenario (M5). Never changes the plan until a member
 * applies it after confirming; applied ones stay as a record of the decision.
 */
export interface DelayHypothesis {
  id: Uuid;
  organizationId: Uuid;
  /** Null once the task was deleted (applied hypotheses are kept). */
  taskId: Uuid | null;
  /** The task's title when the hypothesis was saved; a label, never free text. */
  taskTitle: string;
  delayMinutes: number;
  mode: DelayMode;
  /** true when the user entered an estimate rather than a known delay. */
  estimated: boolean;
  /** Null for guests (`restricted`). */
  note: string | null;
  createdBy: UserRef;
  createdAt: IsoInstant;
  appliedAt: IsoInstant | null;
  appliedBy: UserRef | null;
  /** True when the note was withheld for this viewer. */
  restricted: boolean;
}

/** `delayMinutes` 1–MAX_DELAY_MINUTES; `note` up to HYPOTHESIS_NOTE_MAX. */
export interface HypothesisInput {
  organizationId: Uuid;
  taskId: Uuid;
  delayMinutes: number;
  mode?: DelayMode;
  estimated?: boolean;
  note?: string | null;
}

/** One task as the user saw it moved in the confirmation. */
export interface ShiftExpectation {
  id: Uuid;
  version: number;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
}

export interface ApplyHypothesisInput {
  /** Every task the hypothesis moves (root included), as confirmed. */
  expected: ShiftExpectation[];
  /** Also set the delayed task's status to `delayed` (planned/confirmed only). */
  markDelayed?: boolean;
}

export interface ApplyHypothesisResponse {
  hypothesis: DelayHypothesis;
  /** The tasks that changed, as stored now. */
  tasks: Task[];
}

/**
 * E2: where a confirmed move came from. `conflict_delay` / `conflict_advance`
 * = an exit offered by a conflict warning; `calendar` = long-press drag or
 * its keyboard equivalent.
 */
export type MoveOrigin =
  | 'conflict_delay'
  | 'conflict_advance'
  | 'calendar'
  /** «Deshacer» of a confirmed move: puts the moved tasks back (see the route table). */
  | 'undo';

/**
 * E2: move one task by `minutes` (signed, non-zero, multiple of
 * MOVE_STEP_MINUTES, |minutes| ≤ MAX_DELAY_MINUTES). Later: its dependants
 * shift as in `simulateDelay`. Earlier: only the task moves (dependants are
 * never pulled earlier). `expected` lists every task the move changes, as the
 * user confirmed it (`shiftExpectations(analyzeMove(…).impact, tasks)`).
 * For `undo`, see the route table.
 */
export interface MoveTaskInput {
  minutes: number;
  origin: MoveOrigin;
  /**
   * The warning that offered this exit (origin conflict_*). Validated
   * (at most 200 characters) but not stored in E2: the history records the
   * origin.
   */
  warningKey?: string | null;
  expected: ShiftExpectation[];
}

export interface MoveTaskResponse {
  /** The tasks that changed, as stored now. */
  tasks: Task[];
}

/** One task's window when a conflict was accepted (E2). */
export interface AcceptedWindow {
  taskId: Uuid;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
}

/**
 * E2: «Mantener ambas». A conflict warning the team decided to live with,
 * with a short reason. It applies while every task in `windows` keeps exactly
 * that window; if one moves, the warning opens again (the acceptance stays as
 * a record). Kept in the day close.
 */
export interface ConflictAcceptance {
  id: Uuid;
  organizationId: Uuid;
  /** `PlanWarning.key` of the accepted conflict. */
  warningKey: string;
  windows: AcceptedWindow[];
  /** 3–ACCEPT_REASON_MAX characters. Null for guests (`restricted`). */
  reason: string | null;
  acceptedBy: UserRef;
  /** Safety audit: the administrator behind a support session that signed it. */
  acceptedBySupport?: UserRef;
  acceptedAt: IsoInstant;
  restricted: boolean;
}

export interface ConflictAcceptanceInput {
  organizationId: Uuid;
  warningKey: string;
  /** The windows as the user saw them; must match the current plan (409 otherwise). */
  windows: AcceptedWindow[];
  reason: string;
}

// ---------------------------------------------------------------- contacts, companies, catalogue (M3)

export type CategoryScope = 'service' | 'resource';

export interface Category {
  id: Uuid;
  organizationId: Uuid;
  /** Which lists use it: `service` = companies and offers (M3), `resource` = inventory (M4). */
  scope: CategoryScope;
  name: string;
  /** Built-in categories cannot be deleted; users can add more. */
  builtIn: boolean;
}

export interface CategoryInput {
  organizationId: Uuid;
  scope: CategoryScope;
  /** 1–60 characters; trimmed, inner whitespace collapsed. */
  name: string;
}

/**
 * Not every counterpart is a supplier: municipal departments, associations
 * and the like live in the same list («Empresas y entidades»).
 */
export type CompanyKind = 'supplier' | 'public_body' | 'association' | 'other';

export interface Company extends RecordMeta {
  organizationId: Uuid;
  name: string;
  /** Defaults to `supplier` (also when created by name from a task or offer). */
  kind: CompanyKind;
  /** Scope `service`, in category order. */
  categoryIds: Uuid[];
  /** Null for guests (`restricted`). */
  phone: string | null;
  /** Null for guests (`restricted`). */
  email: string | null;
  website: string | null;
  /** Null for guests (`restricted`). */
  notes: string | null;
  /** Main contact person: always one of this company's contacts. */
  mainContactId: Uuid | null;
  contactCount: number;
  offerCount: number;
  /**
   * E5: the tax it charges, as somebody stated it; null = nobody said
   * (never assumed). Its offers inherit it unless they set their own.
   */
  tax: TaxInfo | null;
  /** True when contact details and notes were withheld for this viewer. */
  restricted: boolean;
}

/**
 * Create: `organizationId` and `name` required. Update: `version` required;
 * only the fields sent change. `categoryIds` replaces the whole list (scope
 * `service`, same organization). `mainContactId` must be a contact whose
 * company is this one (400 otherwise). Same name as another company of the
 * organization (any case) → 409 DUPLICATE with `current` = that company.
 */
export interface CompanyInput extends ProvenanceInput, DeviceIdInput {
  organizationId?: Uuid;
  name?: string;
  kind?: CompanyKind;
  categoryIds?: Uuid[];
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
  mainContactId?: Uuid | null;
  /** E5: null clears it («nadie lo ha dicho»); see `TaxInput`. */
  tax?: TaxInput | null;
  version?: number;
}

export interface Contact extends RecordMeta {
  organizationId: Uuid;
  name: string;
  role: string | null;
  company: {id: Uuid; name: string} | null;
  /** Null for guests (`restricted`). */
  phone: string | null;
  /** Null for guests (`restricted`). */
  email: string | null;
  /** Null for guests (`restricted`). */
  description: string | null;
  /** Null for guests (`restricted`). */
  notes: string | null;
  /** Linked events of the same organization. */
  eventIds: Uuid[];
  /** True when contact details and observations were withheld for this viewer. */
  restricted: boolean;
}

/**
 * Create: `organizationId` and `name` required (two people may share a
 * name). Update: `version` required. `companyId` wins over `companyName`
 * (find-or-create by name). Moving a contact to another company (or none)
 * clears it as main contact of the old one (whose version increases).
 * `eventIds` replaces the whole list (same organization).
 */
export interface ContactInput extends ProvenanceInput, DeviceIdInput {
  organizationId?: Uuid;
  name?: string;
  role?: string | null;
  companyId?: Uuid | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  description?: string | null;
  notes?: string | null;
  eventIds?: Uuid[];
  version?: number;
}

export type PriceUnit =
  'unit' | 'metre' | 'hour' | 'day' | 'km' | 'pack' | 'custom';

/**
 * A product or service a company offers. Amounts are euros with at most two
 * decimals (0 – MAX_AMOUNT_EUR); `null` = unknown, never 0. Costs are kept
 * apart and never summed into an invented total when one is unknown.
 * A unit such as «kg» is only a billing unit: it never derives a load per
 * square metre and never answers a task's heavy-load question.
 */
export interface Offer extends RecordMeta {
  organizationId: Uuid;
  company: {id: Uuid; name: string};
  /** Scope `service`. */
  categoryId: Uuid | null;
  name: string;
  description: string | null;
  /** Euros per unit, null when unknown («Pendiente de verificar») or `restricted`. */
  price: number | null;
  unit: PriceUnit;
  /** Wording of a custom unit (e.g. «por escenario»); null until known. Cleared when unit ≠ custom. */
  customUnit: string | null;
  /** Null when unknown or `restricted`. */
  transportCost: number | null;
  /** Null when unknown or `restricted`. */
  assemblyCost: number | null;
  /** Null when unknown or `restricted`. */
  maintenanceCost: number | null;
  /** Null when unknown or `restricted`. */
  conditions: string | null;
  /**
   * Whether the written price includes tax, as recorded: true = includes it,
   * false = before tax, null = not known (never assumed). New offers default
   * to false (E5: prices are entered before tax).
   */
  vatIncluded: boolean | null;
  /**
   * E5: this offer's own tax; null = it inherits its company's
   * (`companyTax`). Null for guests (`restricted`).
   */
  tax: TaxInfo | null;
  /**
   * E5: the company's tax as it is now (a copy of `Company.tax`, so the
   * effective tax needs no other list: `offerTax` in money.ts). Null for
   * guests (`restricted`).
   */
  companyTax: TaxInfo | null;
  /** True when prices, costs and conditions were withheld for this viewer. */
  restricted: boolean;
}

/**
 * Create: `organizationId`, `name` and a company (`companyId`, or
 * `companyName` to find or create it) required; `unit` defaults to `unit`.
 * Update: `version` required; only the fields sent change.
 */
export interface OfferInput extends ProvenanceInput, DeviceIdInput {
  organizationId?: Uuid;
  companyId?: Uuid;
  companyName?: string;
  categoryId?: Uuid | null;
  name?: string;
  description?: string | null;
  price?: number | null;
  unit?: PriceUnit;
  customUnit?: string | null;
  transportCost?: number | null;
  assemblyCost?: number | null;
  maintenanceCost?: number | null;
  conditions?: string | null;
  /** Omitted on create = false (before tax); null = not known. */
  vatIncluded?: boolean | null;
  /** E5: the offer's own tax; null = inherit the company's. */
  tax?: TaxInput | null;
  version?: number;
}

// ---------------------------------------------------------------- inventories (M4)

/**
 * A place where the organization keeps material. Name and address only: no
 * map geometry (a storage area on the venue map needs its own plan, because
 * it must never block routes A/B/C or accessibility services).
 */
export interface Warehouse extends RecordMeta {
  organizationId: Uuid;
  name: string;
  /** Null when unknown or `restricted`. */
  address: string | null;
  /** Null for guests (`restricted`). */
  notes: string | null;
  resourceCount: number;
  /** E2: as edited; null = not set (the UI proposes one). */
  acronym: string | null;
  /** E2: null = not known. */
  openingHours: OpeningHours | null;
  /** True when address and notes were withheld for this viewer. */
  restricted: boolean;
}

/**
 * Create: `organizationId` and `name` required. Update: `version` required.
 * Same name as another warehouse of the organization (any case) → 409
 * DUPLICATE with `current`.
 */
export interface WarehouseInput extends ProvenanceInput, DeviceIdInput {
  organizationId?: Uuid;
  name?: string;
  address?: string | null;
  notes?: string | null;
  acronym?: string | null;
  openingHours?: OpeningHours | null;
  version?: number;
}

export type ResourceCondition = 'good' | 'fair' | 'damaged' | 'unknown';
export type ResourceAvailability =
  'available' | 'in_use' | 'maintenance' | 'unknown';
/** owned = physical item of the organization; contracted = service from a company. */
export type ResourceOwnership = 'owned' | 'contracted';

/**
 * An inventory item. Quantity, unit (even «kg») and dimensions describe what
 * was observed: they never combine into a load per square metre and never
 * answer a task's heavy-load question (that is the simulator's X-ray check).
 */
export interface Resource extends RecordMeta {
  organizationId: Uuid;
  name: string;
  ownership: ResourceOwnership;
  /** Scope `resource`. */
  categoryId: Uuid | null;
  /** Where it is kept (owned or contracted). */
  warehouse: {id: Uuid; name: string} | null;
  /** Contracted only: who provides it. Always null for owned resources. */
  company: {id: Uuid; name: string} | null;
  /** Contracted only: the offer it comes from (an offer of `company`). */
  offerId: Uuid | null;
  /** Null = not counted yet, never 0. */
  quantity: number | null;
  /** «unidades» by default; «m», «m²», «kg», «juegos»… as typed. */
  unit: string;
  /** Dimensions as observed, e.g. «3 × 6 m». */
  dimensions: string | null;
  condition: ResourceCondition;
  availability: ResourceAvailability;
  /** Where inside the warehouse («Nave 2, estantería 3»). Null when unknown or `restricted`. */
  location: string | null;
  /** «Aún por evaluar»: quantity and condition not assessed yet. */
  toAssess: boolean;
  /** Null for guests (`restricted`). */
  notes: string | null;
  /** Tasks that use it (computed). */
  taskIds: Uuid[];
  /** E3: photos, main first (at most MEDIA_PER_RECORD). */
  media: MediaInfo[];
  /** True when location and notes were withheld for this viewer. */
  restricted: boolean;
}

/**
 * Create: `organizationId` and `name` required; `ownership` defaults to
 * `owned`, `unit` to «unidades», condition and availability to `unknown`.
 * Update: `version` required; only the fields sent change.
 * `warehouseId` wins over `warehouseName` (find-or-create by name).
 * `companyId` wins over `companyName` (find-or-create, kind `supplier`).
 * Company and offer are for contracted resources: sending them with
 * `ownership: owned` is a 400, and changing a resource to owned clears them.
 * An offer must belong to the resource's company; an offer without a company
 * sets the company to the offer's. `quantity` is 0 – MAX_RESOURCE_QUANTITY
 * with at most two decimals, or null.
 */
export interface ResourceInput extends ProvenanceInput, DeviceIdInput {
  organizationId?: Uuid;
  name?: string;
  ownership?: ResourceOwnership;
  categoryId?: Uuid | null;
  warehouseId?: Uuid | null;
  warehouseName?: string | null;
  companyId?: Uuid | null;
  companyName?: string | null;
  offerId?: Uuid | null;
  quantity?: number | null;
  unit?: string;
  dimensions?: string | null;
  condition?: ResourceCondition;
  availability?: ResourceAvailability;
  location?: string | null;
  toAssess?: boolean;
  notes?: string | null;
  version?: number;
}

// ---------------------------------------------------------------- notes, search, report (M4–M6)

export type NoteKind =
  'note' | 'incident' | 'decision' | 'open_question' | 'feature_idea';

/** Records a note can point at (besides its event). */
export type NoteRefType =
  'task' | 'venue' | 'company' | 'contact' | 'offer' | 'warehouse' | 'resource';

/**
 * Operational notes. An «incident» here is a logistics incident (late truck,
 * missing fence); Punto Violeta cases and data about people who were attended
 * are never recorded in this tool. The text is never searched, never quoted
 * in labels (activity, search, links) and never exported without a safety
 * review.
 */
export interface Note extends RecordMeta {
  organizationId: Uuid;
  kind: NoteKind;
  /** Null for guests (`restricted`). */
  text: string | null;
  event: {id: Uuid; name: string} | null;
  /** Optional link to one record; `label` is that record's name, never note text. */
  ref: {type: NoteRefType; id: Uuid; label: string} | null;
  /** Incidents and open questions: resolved / answered. */
  resolved: boolean;
  /**
   * E3, open questions: the current answer (null when none). Its `text` is
   * null for guests. Earlier answers come from GET /notes/:id/answers.
   */
  answer: NoteAnswer | null;
  /** E3: who marked it resolved / answered, and when (null while open). */
  resolvedBy: UserRef | null;
  resolvedAt: IsoInstant | null;
  /** True when the text was withheld for this viewer. */
  restricted: boolean;
}

/** E3: one answer to an open question. Answers are never edited, only replaced. */
export interface NoteAnswer {
  id: Uuid;
  noteId: Uuid;
  /** 1–NOTE_TEXT_MAX. Null for guests (`restricted`). */
  text: string | null;
  answeredBy: UserRef;
  answeredAt: IsoInstant;
  /** The answer this one replaced, if any. */
  replacesId: Uuid | null;
  restricted: boolean;
}

export interface NoteAnswerInput {
  text: string;
  /** Id of the current answer the user saw and chose to replace; null when none. */
  replaces: Uuid | null;
}

// ---------------------------------------------------------------- media (E3)

export type MediaOwnerType = 'resource' | 'user';

/** An image stored by the server (bytes in PostgreSQL, so backups include it). */
export interface MediaInfo {
  id: Uuid;
  ownerType: MediaOwnerType;
  ownerId: Uuid;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: number;
  width: number;
  height: number;
  main: boolean;
  createdBy: UserRef;
  createdAt: IsoInstant;
}

/**
 * Upload as JSON with base64 data (images are resized on the device first,
 * so the body stays small and the offline outbox can queue it like any write).
 * `id` is a device-generated UUID (replay-safe like other creates).
 */
export interface MediaUploadInput extends DeviceIdInput {
  organizationId: Uuid;
  ownerType: MediaOwnerType;
  ownerId: Uuid;
  contentType: MediaInfo['contentType'];
  width: number;
  height: number;
  /** Base64 of the image bytes (no data: prefix). */
  data: string;
  main?: boolean;
}

/**
 * Create: `organizationId`, `kind` and `text` (1–NOTE_TEXT_MAX) required.
 * Update: `version` required. `ref` = {type, id} of a record of the same
 * organization (unknown → 400 `fields.ref`); `eventId` likewise.
 */
export interface NoteInput extends ProvenanceInput, DeviceIdInput {
  organizationId?: Uuid;
  kind?: NoteKind;
  text?: string;
  eventId?: Uuid | null;
  ref?: {type: NoteRefType; id: Uuid} | null;
  resolved?: boolean;
  version?: number;
}

export type SearchEntityType =
  | 'event'
  | 'task'
  | 'venue'
  | 'company'
  | 'contact'
  | 'offer'
  | 'warehouse'
  | 'resource'
  | 'note';

export interface SearchHit {
  type: SearchEntityType;
  id: Uuid;
  title: string;
  subtitle: string | null;
  score: number;
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
}

export interface RecentSearch {
  query: string;
  at: IsoInstant;
}

/** 1–100 characters; the same query (accent/case-insensitive) moves to the top. */
export interface RecentSearchInput {
  query: string;
}

// The day close (M6) is built in the browser: its types live with the
// builder in `day-report.ts` (like work orders in `work-order.ts`).

// ---------------------------------------------------------------- Revisión 1 · E5: taxes and budget

/**
 * `igic` / `iva`: the Canary / mainland VAT; `other`: another one, named
 * («IPSI»…); `none`: the company charges no tax (rate 0); `unknown`: somebody
 * said they do not know yet («sin saber»). A record with no tax at all
 * (`tax: null`) means nobody said anything.
 */
export type TaxRegime = 'igic' | 'iva' | 'other' | 'none' | 'unknown';

/** «Por verificar» until someone confirms it. */
export type TaxVerification = 'to_verify' | 'validated';

/** A tax as recorded; a percentage is never assumed for old records. */
export interface TaxInfo {
  regime: TaxRegime;
  /** `other` only (1–TAX_NAME_MAX characters); null for every other regime. */
  name: string | null;
  /**
   * 0–100 with at most two decimals. `none` → 0; `unknown` → null; `igic`,
   * `iva` and `other` → the stated rate, or null while not known.
   */
  ratePercent: number | null;
  verification: TaxVerification;
}

/**
 * How a tax is sent (`normalizeTax` in money.ts reads it): `ratePercent`
 * omitted for `igic` / `iva` takes DEFAULT_TAX_RATE (7 % / 21 %);
 * `verification` omitted is `to_verify`. Problems → 400 `fields['tax.<key>']`.
 */
export interface TaxInput {
  regime: TaxRegime;
  name?: string | null;
  ratePercent?: number | null;
  verification?: TaxVerification;
}

export type ExpenseStatus = 'planned' | 'confirmed';

/**
 * The budget of one event: a single total in euros, taxes included (what the
 * event may actually spend). Every event has one: `amount` null and
 * `version` 0 until somebody sets it. Only for viewers with `budget.read`.
 */
export interface EventBudget {
  eventId: Uuid;
  /** Euros; null = not set yet. */
  amount: number | null;
  /** 0 = never set (send 0 to set it the first time). */
  version: number;
  updatedBy: UserRef | null;
  updatedAt: IsoInstant | null;
}

export interface EventBudgetInput {
  /** 0 – MAX_AMOUNT_EUR, two decimals; null clears it. */
  amount: number | null;
  version: number;
}

/**
 * A copy of an offer as it was when an expense was created from it. Never
 * updated: editing, renegotiating or deleting the offer (or its company)
 * leaves it as it was.
 */
export interface OfferSnapshot {
  offerId: Uuid;
  offerName: string;
  companyName: string;
  /** As written in the offer (see `vatIncluded`). */
  price: number | null;
  unit: PriceUnit;
  customUnit: string | null;
  vatIncluded: boolean | null;
  /** The offer's effective tax then (its own, or its company's). */
  tax: TaxInfo | null;
  /** True when `tax` came from the company. */
  taxInherited: boolean;
  transportCost: number | null;
  assemblyCost: number | null;
  maintenanceCost: number | null;
  at: IsoInstant;
}

/**
 * One expense of an event's budget. Not accounting: no invoices, no
 * payments. Only for viewers with `budget.read`.
 */
export interface Expense extends RecordMeta {
  organizationId: Uuid;
  eventId: Uuid;
  concept: string;
  /**
   * The company it is paid to. `id` null once that company was deleted: the
   * name it had stays.
   */
  company: {id: Uuid | null; name: string} | null;
  /** Euros before tax; null = not known yet (never counted as 0). */
  amount: number | null;
  /** Null = nobody said. */
  tax: TaxInfo | null;
  status: ExpenseStatus;
  /** Set when it was created from a catalogue offer; never changes. */
  snapshot: OfferSnapshot | null;
  notes: string | null;
}

/**
 * Create: `eventId` and a `concept` required (from an offer, the concept
 * defaults to the offer's name). Update: `version` required; only the fields
 * sent change; `eventId` and `offerId` are create-only (ignored on update).
 * From an offer (`offerId`, needs `directory.read` too): the snapshot is
 * copied on the server, and omitted `companyId`, `amount` and `tax` default
 * to the offer's company, its price before tax (`priceEstimate`, null when
 * it cannot be derived) and its effective tax.
 */
export interface ExpenseInput extends ProvenanceInput, DeviceIdInput {
  eventId?: Uuid;
  offerId?: Uuid | null;
  concept?: string;
  companyId?: Uuid | null;
  amount?: number | null;
  tax?: TaxInput | null;
  status?: ExpenseStatus;
  notes?: string | null;
  version?: number;
}

/** `GET /events/:id/budget`. */
export interface EventBudgetResponse {
  budget: EventBudget;
  /** Oldest first. */
  expenses: Expense[];
}

/**
 * Sums of a set of expenses (`budgetSummary` in money.ts). Unknown amounts
 * and taxes are counted apart, never as 0.
 */
export interface ExpenseTotals {
  count: number;
  /** Sum of the known amounts, before tax. */
  beforeTax: number;
  /** «Estimación» with tax of those whose amount and rate are known. */
  withTax: number;
  /** Expenses whose amount is not known (in neither sum). */
  unknownAmount: number;
  /** Known amount, tax rate not known: in `beforeTax`, not in `withTax`. */
  unknownTax: number;
  /** In `withTax` with a tax still «por verificar». */
  taxToVerify: number;
}

/** One event's budget at a glance (Hoy, Calendario, the budget sheet). */
export interface BudgetSummary {
  eventId: Uuid;
  /** The budget (taxes included); null = not set. */
  amount: number | null;
  planned: ExpenseTotals;
  confirmed: ExpenseTotals;
  /** Planned and confirmed together. */
  total: ExpenseTotals;
  /** `amount` − `total.withTax` («estimación»); null without a budget. */
  remaining: number | null;
  /** Some expense is missing from `total.withTax`: `remaining` is optimistic. */
  incomplete: boolean;
}

// ---------------------------------------------------------------- Revisión 1 · E6–E7: offer terms, quote requests, proposals

/**
 * How a price is charged. `offerCost` (offer-terms.ts) turns it into the cost
 * of a concrete need; `pack` and `custom` never give a total (nobody knows
 * how many packs or custom units a need takes).
 */
export type PriceBasis =
  /** Per unit and day («por carpa y jornada»). */
  | 'unit_day'
  /** Per person and day. */
  | 'person_day'
  /** Per unit, the whole event. */
  | 'unit_event'
  /** Per hour and person (needs the hours per day). */
  | 'hour_person'
  /** Per hour of one team or machine (needs the hours per day). */
  | 'hour'
  /** One closed price for the whole order. */
  | 'order'
  /** Per complete service. */
  | 'service'
  | 'pack'
  | 'custom';

/**
 * A seasonal unit price (before tax) that replaces the base one on the days
 * of its months (1–12). Seasons are the company's own; «verano» (jun–sep) and
 * «lluvias» (nov–mar) are only the form's defaults (DEFAULT_SEASONS). A
 * month belongs to one season at most.
 */
export interface SeasonRate {
  label: string;
  months: number[];
  price: number;
}

export type SupplementKind = 'transport' | 'assembly' | 'maintenance' | 'other';

/**
 * `order`: once; `unit`: per unit; `unit_day`: per unit and day; `day`: per
 * day; `percent`: `amount` is a percentage of the base price.
 */
export type SupplementPer = 'order' | 'unit' | 'unit_day' | 'day' | 'percent';

/**
 * Something charged (or included) besides the base price, before tax.
 * `included`: in the price, never added. `amount` null = it is charged but
 * nobody gave the price (the total stays unknown). `on_request`: only if it
 * is asked for (night shift, extra cleaning): shown apart, never added.
 */
export interface Supplement {
  label: string;
  kind: SupplementKind;
  included: boolean;
  amount: number | null;
  per: SupplementPer;
  applies: 'always' | 'on_request';
}

/** A multi-year deal: a unit price (before tax) if hired for `years` years. */
export interface Commitment {
  years: number;
  price: number | null;
  conditions: string | null;
}

/**
 * The terms of one offer version. All prices before tax unless
 * `pricesIncludeTax` (same meaning as `Offer.vatIncluded`). Three dates are
 * kept apart: `acceptUntil` (until when the offer can be accepted; after it
 * the offer is expired: history only, never compared as current),
 * `serviceMonths` (when the company can provide it) and `commitment` (how
 * many years a deal binds).
 */
export interface OfferTerms {
  basis: PriceBasis;
  /** Wording for `custom` («por escenario»); null otherwise. */
  customUnit: string | null;
  /** Base unit price; null = not given (no total). */
  price: number | null;
  /** True: the prices written include tax; null: nobody said. */
  pricesIncludeTax: boolean | null;
  seasonal: SeasonRate[];
  supplements: Supplement[];
  /** What the company does not do or provide («Lastres»), as written. */
  notIncluded: string[];
  /** Charged at least this many days / units / euros. */
  minimumDays: number | null;
  minimumQuantity: number | null;
  minimumOrder: number | null;
  /** Last local day the offer can be accepted; null = not stated. */
  acceptUntil: LocalDate | null;
  /** Months (1–12) it can be provided, ascending; null = not known. */
  serviceMonths: number[] | null;
  serviceNote: string | null;
  commitment: Commitment | null;
  /** Special conditions, as written. */
  conditions: string | null;
  /** Units the company has available; null = not said. */
  available: number | null;
  /**
   * The tax the company stated for this version («por verificar» unless it
   * matched its known tax); null = the offer's effective tax applies (E5).
   */
  tax: TaxInfo | null;
}

/**
 * `current`: the version in force; `expired`: in force but past
 * `acceptUntil` (history only); `superseded`: replaced by a later version.
 */
export type OfferVersionStatus = 'current' | 'expired' | 'superseded';

/**
 * One version of an offer's terms. Versions are never edited: renegotiating
 * approves a new one and the previous one becomes `superseded`. Expenses keep
 * their own snapshot (E5) and never change with a new version.
 */
export interface OfferVersion {
  id: Uuid;
  organizationId: Uuid;
  offerId: Uuid;
  /** 1, 2, 3… per offer. */
  number: number;
  status: OfferVersionStatus;
  terms: OfferTerms;
  /** «170 € → 180 € por carpa y jornada», or how it reached the catalogue. */
  changeNote: string | null;
  /** The proposal it was approved from; null for the catalogue data kept as version 1. */
  proposalId: Uuid | null;
  approvedBy: UserRef | null;
  createdBy: UserRef;
  createdAt: IsoInstant;
  supersededAt: IsoInstant | null;
}

/** A concrete need: what is asked to companies and compared. */
export interface QuoteNeed {
  /** «3 carpas de 6 × 6 m». */
  title: string;
  /** Scope `service`; null = not classified. */
  categoryId: Uuid | null;
  quantity: number;
  /** «carpas», «personas»; null = units. */
  unitLabel: string | null;
  days: number;
  /** For prices per hour; null = not known. */
  hoursPerDay: number | null;
  dateFrom: LocalDate | null;
  /** Null = same day as `dateFrom`. */
  dateTo: LocalDate | null;
  /** Shown to the companies above the form. */
  note: string | null;
}

/**
 * `waiting` → the company has not answered; `answered` → its proposal waits
 * in the inbox; `approved` / `rejected` → decided; `declined` → it said it
 * cannot; `revoked` → the link was replaced, or the request closed.
 */
export type QuoteLinkStatus =
  'waiting' | 'answered' | 'approved' | 'rejected' | 'declined' | 'revoked';

/** One company's personal link to a request (the token itself is never stored). */
export interface QuoteRequestLink {
  id: Uuid;
  /** `id` null once the company was deleted (the name stays). */
  company: {id: Uuid | null; name: string};
  status: QuoteLinkStatus;
  expiresAt: IsoInstant;
  /** Past `expiresAt` (only meaningful while `waiting`). */
  expired: boolean;
  openedAt: IsoInstant | null;
  answeredAt: IsoInstant | null;
  /** What the company said when declining; null otherwise. */
  declineReason: string | null;
  proposalId: Uuid | null;
}

export type QuoteRequestStatus = 'open' | 'closed';

export interface QuoteRequest {
  id: Uuid;
  organizationId: Uuid;
  need: QuoteNeed;
  eventId: Uuid | null;
  /** The catalogue offer it renegotiates; null for a new need. */
  offerId: Uuid | null;
  status: QuoteRequestStatus;
  links: QuoteRequestLink[];
  createdBy: UserRef;
  createdAt: IsoInstant;
  closedBy: UserRef | null;
  closedAt: IsoInstant | null;
  version: number;
}

export interface QuoteNeedInput {
  title: string;
  categoryId?: Uuid | null;
  quantity: number;
  unitLabel?: string | null;
  days: number;
  hoursPerDay?: number | null;
  dateFrom?: LocalDate | null;
  dateTo?: LocalDate | null;
  note?: string | null;
}

/**
 * `companyIds`: 1–QUOTE_MAX_COMPANIES companies of the organization; one
 * personal link each, valid `linkDays` (QUOTE_LINK_DAYS_DEFAULT).
 */
export interface QuoteRequestInput {
  organizationId: Uuid;
  need: QuoteNeedInput;
  eventId?: Uuid | null;
  offerId?: Uuid | null;
  companyIds: Uuid[];
  linkDays?: number;
}

export interface QuoteLinksInput {
  companyIds: Uuid[];
  linkDays?: number;
}

/**
 * A personal link as issued: the only time its address exists. The UI
 * prepares an e-mail (mailto) that the user sends from their own mail; the
 * server never writes to companies.
 */
export interface IssuedQuoteLink {
  linkId: Uuid;
  company: {id: Uuid; name: string; email: string | null};
  url: string;
  expiresAt: IsoInstant;
}

export interface QuoteRequestCreated {
  request: QuoteRequest;
  links: IssuedQuoteLink[];
}

export type ProposalVia = 'link' | 'open' | 'manual';
export type ProposalState = 'pending' | 'approved' | 'rejected';

/** A free answer of the guided form (category-specific questions). */
export type ProposalAnswer = string | number | boolean | null;

/** One product or service of a proposal; becomes one offer when approved. */
export interface ProposalProductInput {
  /** Unique within the proposal (1–40 characters). */
  key: string;
  /** The form's activity («carpas», «limpieza»…); null = generic. */
  categoryKey: string | null;
  name: string;
  description?: string | null;
  /** Category questions: at most PROPOSAL_MAX_ANSWERS keys. */
  answers?: Record<string, ProposalAnswer>;
  available?: number | null;
  basis: PriceBasis;
  customUnit?: string | null;
  price: number | null;
  seasonal?: SeasonRate[];
  supplements?: Supplement[];
  notIncluded?: string[];
  minimumDays?: number | null;
  minimumQuantity?: number | null;
  minimumOrder?: number | null;
  /** Unit price under the proposal's `commitment`, if any. */
  commitmentPrice?: number | null;
  conditions?: string | null;
}

/**
 * What a company sends (E7 form) or a member records by hand. Prices before
 * tax unless `pricesIncludeTax`. The stated tax enters «por verificar».
 * `privacyAccepted` must be true on the public routes.
 */
export interface ProposalInput {
  /** `similar`: not exactly what was asked, but close. */
  intent?: 'yes' | 'similar';
  company: {
    name: string;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  products: ProposalProductInput[];
  tax: TaxInput | null;
  pricesIncludeTax: boolean | null;
  acceptUntil: LocalDate | null;
  serviceMonths: number[] | null;
  serviceNote?: string | null;
  commitment?: {years: number; conditions?: string | null} | null;
  conditions?: string | null;
  privacyAccepted?: boolean;
}

/** A proposal as stored: the input, normalized (tax as TaxInfo). */
export interface ProposalContent extends Omit<
  ProposalInput,
  'tax' | 'privacyAccepted'
> {
  tax: TaxInfo | null;
  /** Version of SUPPLIER_PRIVACY_TEXT accepted; null when recorded by hand. */
  privacyVersion: string | null;
}

export interface ProposalResult {
  productKey: string;
  offerId: Uuid;
  versionNumber: number;
  /** True when approving created the offer. */
  created: boolean;
}

/**
 * A proposal in the inbox. Never visible to other companies; the public
 * routes only answer «received». Contents need `directory.read`.
 */
export interface Proposal {
  id: Uuid;
  organizationId: Uuid;
  via: ProposalVia;
  state: ProposalState;
  receivedAt: IsoInstant;
  request: {id: Uuid; title: string} | null;
  /** The offer it renegotiates; null for a new one. */
  offer: {id: Uuid; name: string} | null;
  /** The company of the organization with that name (or created on approval); null if none yet. */
  company: {id: Uuid; name: string} | null;
  content: ProposalContent;
  /** How a hand-recorded proposal reached us («por teléfono»); null otherwise. */
  origin: string | null;
  /** Points to check before approving (`proposalFlags`). */
  flags: string[];
  createdBy: UserRef | null;
  decidedBy: UserRef | null;
  /**
   * The administrator behind the support session that decided it (migration
   * 0012); absent for a normal session. Show «Dailos (soporte: Elvis)».
   */
  decidedBySupport?: UserRef;
  decidedAt: IsoInstant | null;
  /** Required to reject (PROPOSAL_REASON_MIN–MAX). */
  rejectReason: string | null;
  result: ProposalResult[];
  version: number;
}

/** A member records a proposal received by phone, e-mail or in person. */
export interface ManualProposalInput {
  organizationId: Uuid;
  offerId?: Uuid | null;
  requestId?: Uuid | null;
  origin: string;
  proposal: ProposalInput;
}

/**
 * Per product: `offerId` = version that offer (same company); omitted or null
 * = a new offer (the proposal's offer when it renegotiates one product).
 * `categoryId` overrides the category (scope `service`); `skip` leaves the
 * product out. Without `products`, every product with its default.
 */
export interface ProposalApproveInput {
  version: number;
  products?: {
    key: string;
    offerId?: Uuid | null;
    categoryId?: Uuid | null;
    skip?: boolean;
  }[];
}

export interface ProposalApproveResponse {
  proposal: Proposal;
  offers: Offer[];
  versions: OfferVersion[];
}

export interface ProposalRejectInput {
  version: number;
  reason: string;
}

/** The body of every public supplier route carries the link's token. */
export interface SupplierTokenInput {
  token: string;
}

/** `POST /public/requests/lookup`: only this request and these two names. */
export interface PublicQuoteRequest {
  organization: {name: string};
  company: {name: string};
  need: Omit<QuoteNeed, 'categoryId'> & {categoryName: string | null};
  expiresAt: IsoInstant;
  /** `answered` / `declined`: the company already replied through this link. */
  status: 'open' | 'answered' | 'declined';
}

/** `POST /public/offers/lookup` (the open form, only while an admin keeps it on). */
export interface PublicOpenForm {
  organization: {name: string};
}

export interface PublicProposalReceipt {
  receivedAt: IsoInstant;
}

export interface SupplierDeclineInput {
  reason?: string | null;
}

/** Per organization; administrators (`offers.approve`) change it. */
export interface OfferSettings {
  organizationId: Uuid;
  /** Days before `acceptUntil` a renegotiation task is created (RENEWAL_NOTICE_OPTIONS). */
  renewalNoticeDays: number;
  /** The open «presentar oferta» link; off by default. */
  openLink: {enabled: boolean; createdAt: IsoInstant | null};
  /** 0 = never changed. */
  version: number;
  updatedBy: UserRef | null;
  updatedAt: IsoInstant | null;
}

/** `rotateOpenLink`: replace the open link (the old one stops working). */
export interface OfferSettingsInput {
  renewalNoticeDays?: number;
  openLinkEnabled?: boolean;
  rotateOpenLink?: boolean;
  version: number;
}

export interface OfferSettingsResponse {
  settings: OfferSettings;
  /** Only when this change issued a new open link: the one time it exists. */
  openLinkUrl: string | null;
}

/**
 * A renegotiation task Ox Eye generated before an offer version expires.
 * The task itself is an ordinary task without event (company = the offer's);
 * this record is its «Generada por Ox Eye» mark and holds the assignee.
 */
export interface OfferRenewal {
  id: Uuid;
  organizationId: Uuid;
  /** Null once somebody deleted the task (it is not generated again). */
  taskId: Uuid | null;
  /** Deleting the offer deletes this mark (the task stays, as a plain task). */
  offer: {id: Uuid; name: string};
  company: {id: Uuid; name: string};
  versionNumber: number;
  acceptUntil: LocalDate;
  noticeDays: number;
  /** Whoever approved the version; administrators may change it. */
  assignee: UserRef | null;
  generatedBy: 'ox_eye';
  generatedAt: IsoInstant;
  /** Set when a newer version was approved (its task is marked done). */
  resolvedAt: IsoInstant | null;
  resolvedByVersion: number | null;
  version: number;
}

export interface OfferRenewalInput {
  assigneeId: Uuid | null;
  version: number;
}

// ---------------------------------------------------------------- health and errors

export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  version: string;
}

export type ApiErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  /** A record with the same unique name exists; `current` holds it. */
  | 'DUPLICATE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** Every error response has this body. `message` is plain Spanish for the UI. */
export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Field-level problems for VALIDATION: field name → Spanish message. */
  fields?: Record<string, string>;
  /** For VERSION_CONFLICT: the record as it is now on the server; for DUPLICATE: the existing record. */
  current?: unknown;
}
