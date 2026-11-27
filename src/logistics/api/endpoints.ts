/**
 * Typed wrappers for the routes listed in `shared/logistics/contracts.ts`.
 */
import type {
  ActivityEntry,
  AdminProfileInput,
  AdminRolesInput,
  AdminUser,
  ApplyHypothesisInput,
  ApplyHypothesisResponse,
  Category,
  ChangesResponse,
  CategoryInput,
  Company,
  CompanyInput,
  Contact,
  ContactInput,
  ConflictAcceptance,
  ConflictAcceptanceInput,
  CreateEventInput,
  DelayHypothesis,
  EmailVerifyInput,
  HealthResponse,
  HypothesisInput,
  ListResponse,
  LoginRequest,
  LoginResponse,
  LogisticsEvent,
  MediaInfo,
  MediaUploadInput,
  MemberProfile,
  MeResponse,
  MoveTaskInput,
  MoveTaskResponse,
  Note,
  NoteAnswer,
  NoteAnswerInput,
  NoteInput,
  Offer,
  OfferInput,
  Organization,
  OrganizationInput,
  PasswordChangeInput,
  PasswordResetInput,
  Profile,
  ProfileInput,
  ProvisionalPasswordResponse,
  RecentSearch,
  RecentSearchInput,
  RecoveryEmailInput,
  RecoveryRequest,
  ResetLinkResponse,
  Resource,
  ResourceInput,
  SecurityEvent,
  SessionInfo,
  SupportSession,
  SupportSessionInput,
  SupportSessionResponse,
  Task,
  TaskInput,
  UpdateEventInput,
  Venue,
  VenueInput,
  ViewAsGuestInput,
  Warehouse,
  WarehouseInput,
} from '../../../shared/logistics/contracts.ts';
import {
  ApiError,
  apiRequest,
  reportTokenRejected,
  resolveApiBaseUrl,
} from './client';

const enc = encodeURIComponent;

/** Image downloads may take longer than JSON on a weak signal. */
const MEDIA_TIMEOUT_MS = 30_000;

/**
 * The bytes of one image (`GET /media/:id`, authenticated). Not JSON, so it
 * does not go through `apiRequest`; failures map to the same error codes.
 */
async function mediaBlob(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const base = resolveApiBaseUrl();
  if (!base) throw new ApiError({code: 'NOT_CONFIGURED', status: 0});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);
  try {
    const response = await fetch(`${base}/media/${enc(id)}`, {
      headers: {Authorization: `Bearer ${token}`},
      signal: controller.signal,
    });
    if (response.status === 401) {
      reportTokenRejected(token);
      throw new ApiError({code: 'UNAUTHENTICATED', status: 401});
    }
    if (response.status === 404) {
      throw new ApiError({code: 'NOT_FOUND', status: 404});
    }
    const type = response.headers.get('Content-Type') ?? '';
    if (!response.ok || !type.startsWith('image/')) {
      throw new ApiError({code: 'UNAVAILABLE', status: response.status});
    }
    return await response.blob();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError({code: 'UNAVAILABLE', status: 0});
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

export const api = {
  health: (signal?: AbortSignal) =>
    apiRequest<HealthResponse>('GET', '/health', {signal}),

  login: (body: LoginRequest) =>
    apiRequest<LoginResponse>('POST', '/auth/login', {body}),

  logout: (token: string) => apiRequest<void>('POST', '/auth/logout', {token}),

  me: (token: string) => apiRequest<MeResponse>('GET', '/me', {token}),

  events: (token: string, orgId: string) =>
    apiRequest<ListResponse<LogisticsEvent>>(
      'GET',
      `/organizations/${enc(orgId)}/events`,
      {token},
    ),

  createEvent: (token: string, body: CreateEventInput) =>
    apiRequest<LogisticsEvent>('POST', '/events', {token, body}),

  updateEvent: (token: string, id: string, body: UpdateEventInput) =>
    apiRequest<LogisticsEvent>('PATCH', `/events/${enc(id)}`, {token, body}),

  venues: (token: string, orgId: string) =>
    apiRequest<ListResponse<Venue>>(
      'GET',
      `/organizations/${enc(orgId)}/venues`,
      {token},
    ),

  tasks: (token: string, orgId: string) =>
    apiRequest<ListResponse<Task>>(
      'GET',
      `/organizations/${enc(orgId)}/tasks`,
      {token},
    ),

  createTask: (token: string, body: TaskInput) =>
    apiRequest<Task>('POST', '/tasks', {token, body}),

  updateTask: (token: string, id: string, body: TaskInput) =>
    apiRequest<Task>('PATCH', `/tasks/${enc(id)}`, {token, body}),

  deleteTask: (token: string, id: string, version: number) =>
    apiRequest<void>('DELETE', `/tasks/${enc(id)}?version=${version}`, {
      token,
    }),

  companies: (token: string, orgId: string) =>
    apiRequest<ListResponse<Company>>(
      'GET',
      `/organizations/${enc(orgId)}/companies`,
      {token},
    ),

  createCompany: (token: string, body: CompanyInput) =>
    apiRequest<Company>('POST', '/companies', {token, body}),

  updateCompany: (token: string, id: string, body: CompanyInput) =>
    apiRequest<Company>('PATCH', `/companies/${enc(id)}`, {token, body}),

  deleteCompany: (token: string, id: string, version: number) =>
    apiRequest<void>('DELETE', `/companies/${enc(id)}?version=${version}`, {
      token,
    }),

  // ---- milestone 3: categories, contacts, offers, recent searches
  categories: (token: string, orgId: string) =>
    apiRequest<ListResponse<Category>>(
      'GET',
      `/organizations/${enc(orgId)}/categories`,
      {token},
    ),

  createCategory: (token: string, body: CategoryInput) =>
    apiRequest<Category>('POST', '/categories', {token, body}),

  deleteCategory: (token: string, id: string) =>
    apiRequest<void>('DELETE', `/categories/${enc(id)}`, {token}),

  contacts: (token: string, orgId: string) =>
    apiRequest<ListResponse<Contact>>(
      'GET',
      `/organizations/${enc(orgId)}/contacts`,
      {token},
    ),

  createContact: (token: string, body: ContactInput) =>
    apiRequest<Contact>('POST', '/contacts', {token, body}),

  updateContact: (token: string, id: string, body: ContactInput) =>
    apiRequest<Contact>('PATCH', `/contacts/${enc(id)}`, {token, body}),

  deleteContact: (token: string, id: string, version: number) =>
    apiRequest<void>('DELETE', `/contacts/${enc(id)}?version=${version}`, {
      token,
    }),

  offers: (token: string, orgId: string) =>
    apiRequest<ListResponse<Offer>>(
      'GET',
      `/organizations/${enc(orgId)}/offers`,
      {token},
    ),

  createOffer: (token: string, body: OfferInput) =>
    apiRequest<Offer>('POST', '/offers', {token, body}),

  updateOffer: (token: string, id: string, body: OfferInput) =>
    apiRequest<Offer>('PATCH', `/offers/${enc(id)}`, {token, body}),

  deleteOffer: (token: string, id: string, version: number) =>
    apiRequest<void>('DELETE', `/offers/${enc(id)}?version=${version}`, {
      token,
    }),

  recentSearches: (token: string, orgId: string) =>
    apiRequest<ListResponse<RecentSearch>>(
      'GET',
      `/organizations/${enc(orgId)}/recent-searches`,
      {token},
    ),

  pushRecentSearch: (token: string, orgId: string, body: RecentSearchInput) =>
    apiRequest<ListResponse<RecentSearch>>(
      'POST',
      `/organizations/${enc(orgId)}/recent-searches`,
      {token, body},
    ),

  clearRecentSearches: (token: string, orgId: string) =>
    apiRequest<void>('DELETE', `/organizations/${enc(orgId)}/recent-searches`, {
      token,
    }),

  activity: (token: string, orgId: string, limit = 20) =>
    apiRequest<ListResponse<ActivityEntry>>(
      'GET',
      `/organizations/${enc(orgId)}/activity?limit=${limit}`,
      {token},
    ),

  // ---- milestone 4: inventories, notes and the history of one record
  /** History of one record, newest first. */
  history: (
    token: string,
    orgId: string,
    entityType: string,
    entityId: string,
    limit = 50,
  ) =>
    apiRequest<ListResponse<ActivityEntry>>(
      'GET',
      `/organizations/${enc(orgId)}/activity?entityType=${enc(
        entityType,
      )}&entityId=${enc(entityId)}&limit=${limit}`,
      {token},
    ),

  warehouses: (token: string, orgId: string) =>
    apiRequest<ListResponse<Warehouse>>(
      'GET',
      `/organizations/${enc(orgId)}/warehouses`,
      {token},
    ),

  createWarehouse: (token: string, body: WarehouseInput) =>
    apiRequest<Warehouse>('POST', '/warehouses', {token, body}),

  updateWarehouse: (token: string, id: string, body: WarehouseInput) =>
    apiRequest<Warehouse>('PATCH', `/warehouses/${enc(id)}`, {token, body}),

  deleteWarehouse: (token: string, id: string, version: number) =>
    apiRequest<void>('DELETE', `/warehouses/${enc(id)}?version=${version}`, {
      token,
    }),

  resources: (token: string, orgId: string) =>
    apiRequest<ListResponse<Resource>>(
      'GET',
      `/organizations/${enc(orgId)}/resources`,
      {token},
    ),

  createResource: (token: string, body: ResourceInput) =>
    apiRequest<Resource>('POST', '/resources', {token, body}),

  updateResource: (token: string, id: string, body: ResourceInput) =>
    apiRequest<Resource>('PATCH', `/resources/${enc(id)}`, {token, body}),

  deleteResource: (token: string, id: string, version: number) =>
    apiRequest<void>('DELETE', `/resources/${enc(id)}?version=${version}`, {
      token,
    }),

  notes: (token: string, orgId: string) =>
    apiRequest<ListResponse<Note>>(
      'GET',
      `/organizations/${enc(orgId)}/notes`,
      {token},
    ),

  createNote: (token: string, body: NoteInput) =>
    apiRequest<Note>('POST', '/notes', {token, body}),

  updateNote: (token: string, id: string, body: NoteInput) =>
    apiRequest<Note>('PATCH', `/notes/${enc(id)}`, {token, body}),

  deleteNote: (token: string, id: string, version: number) =>
    apiRequest<void>('DELETE', `/notes/${enc(id)}?version=${version}`, {
      token,
    }),

  // ---- Revisión 1 · E3: answers to open questions and material photos
  /** Every answer of a question, newest first (the current one included). */
  noteAnswers: (token: string, noteId: string, signal?: AbortSignal) =>
    apiRequest<ListResponse<NoteAnswer>>(
      'GET',
      `/notes/${enc(noteId)}/answers`,
      {token, signal},
    ),

  createNoteAnswer: (token: string, noteId: string, body: NoteAnswerInput) =>
    apiRequest<NoteAnswer>('POST', `/notes/${enc(noteId)}/answers`, {
      token,
      body,
    }),

  uploadMedia: (token: string, body: MediaUploadInput) =>
    apiRequest<MediaInfo>('POST', '/media', {token, body}),

  setMainMedia: (token: string, id: string) =>
    apiRequest<MediaInfo>('PATCH', `/media/${enc(id)}`, {
      token,
      body: {main: true},
    }),

  deleteMedia: (token: string, id: string) =>
    apiRequest<void>('DELETE', `/media/${enc(id)}`, {token}),

  mediaBlob,

  // ---- milestone 5: delay hypotheses («¿Y si…?»)
  hypotheses: (token: string, orgId: string) =>
    apiRequest<ListResponse<DelayHypothesis>>(
      'GET',
      `/organizations/${enc(orgId)}/hypotheses`,
      {token},
    ),

  createHypothesis: (token: string, body: HypothesisInput) =>
    apiRequest<DelayHypothesis>('POST', '/hypotheses', {token, body}),

  deleteHypothesis: (token: string, id: string) =>
    apiRequest<void>('DELETE', `/hypotheses/${enc(id)}`, {token}),

  applyHypothesis: (token: string, id: string, body: ApplyHypothesisInput) =>
    apiRequest<ApplyHypothesisResponse>(
      'POST',
      `/hypotheses/${enc(id)}/apply`,
      {token, body},
    ),

  // ---- Revisión 1 · E2: accepted conflicts («Mantener ambas»)
  acceptances: (token: string, orgId: string) =>
    apiRequest<ListResponse<ConflictAcceptance>>(
      'GET',
      `/organizations/${enc(orgId)}/conflict-acceptances`,
      {token},
    ),

  createAcceptance: (token: string, body: ConflictAcceptanceInput) =>
    apiRequest<ConflictAcceptance>('POST', '/conflict-acceptances', {
      token,
      body,
    }),

  deleteAcceptance: (token: string, id: string) =>
    apiRequest<void>('DELETE', `/conflict-acceptances/${enc(id)}`, {token}),

  // ---- Revisión 1 · E2: moves (calendar drag, conflict exits, «Deshacer»)
  moveTask: (token: string, id: string, body: MoveTaskInput) =>
    apiRequest<MoveTaskResponse>('POST', `/tasks/${enc(id)}/move`, {
      token,
      body,
    }),

  // ---- Revisión 1 · E2: venue acronym and opening hours
  updateVenue: (token: string, id: string, body: VenueInput) =>
    apiRequest<Venue>('PATCH', `/venues/${enc(id)}`, {token, body}),

  /** E2: the organization's acronym (members only; 409 with `current`). */
  updateOrganization: (token: string, orgId: string, body: OrganizationInput) =>
    apiRequest<Organization>('PATCH', `/organizations/${enc(orgId)}`, {
      token,
      body,
    }),

  // ---- milestone 6: cheap refresh and the day's activity
  /** Which record types changed since `since` (none: a fresh cursor). */
  changes: (token: string, orgId: string, since?: string | null) =>
    apiRequest<ChangesResponse>(
      'GET',
      `/organizations/${enc(orgId)}/changes${since ? `?since=${enc(since)}` : ''}`,
      {token},
    ),

  /** Activity with `from` ≤ at < `to`, newest first (day close). */
  activityBetween: (
    token: string,
    orgId: string,
    from: string,
    to: string,
    limit?: number,
    signal?: AbortSignal,
  ) =>
    apiRequest<ListResponse<ActivityEntry>>(
      'GET',
      `/organizations/${enc(orgId)}/activity?from=${enc(from)}&to=${enc(to)}${
        limit ? `&limit=${limit}` : ''
      }`,
      {token, signal},
    ),

  // ---- Revisión 1 · E4: account links (public, no token)
  /** 202 always, the same whether the account exists or not. */
  requestRecovery: (body: RecoveryRequest) =>
    apiRequest<void>('POST', '/auth/recovery', {body}),

  resetPassword: (body: PasswordResetInput) =>
    apiRequest<void>('POST', '/auth/reset', {body}),

  verifyEmail: (body: EmailVerifyInput) =>
    apiRequest<void>('POST', '/auth/verify-email', {body}),

  // ---- Revisión 1 · E4: own account
  profile: (token: string) =>
    apiRequest<Profile>('GET', '/me/profile', {token}),

  updateProfile: (token: string, body: ProfileInput) =>
    apiRequest<Profile>('PATCH', '/me/profile', {token, body}),

  changePassword: (token: string, body: PasswordChangeInput) =>
    apiRequest<void>('POST', '/me/password', {token, body}),

  /** 202: a verification link goes to that address. */
  requestRecoveryEmail: (token: string, body: RecoveryEmailInput) =>
    apiRequest<void>('POST', '/me/email', {token, body}),

  removeRecoveryEmail: (token: string) =>
    apiRequest<void>('DELETE', '/me/email', {token}),

  markWelcomed: (token: string) =>
    apiRequest<void>('POST', '/me/welcome', {token}),

  sessions: (token: string) =>
    apiRequest<ListResponse<SessionInfo>>('GET', '/me/sessions', {token}),

  endSession: (token: string, id: string) =>
    apiRequest<void>('DELETE', `/me/sessions/${enc(id)}`, {token}),

  endOtherSessions: (token: string) =>
    apiRequest<void>('DELETE', '/me/sessions', {token}),

  ownSecurity: (token: string) =>
    apiRequest<ListResponse<SecurityEvent>>('GET', '/me/security', {token}),

  members: (token: string, orgId: string) =>
    apiRequest<ListResponse<MemberProfile>>(
      'GET',
      `/organizations/${enc(orgId)}/members`,
      {token},
    ),

  // ---- Revisión 1 · E4: administration (`users.manage` unless stated)
  adminUsers: (token: string) =>
    apiRequest<ListResponse<AdminUser>>('GET', '/admin/users', {token}),

  setRoles: (token: string, userId: string, body: AdminRolesInput) =>
    apiRequest<AdminUser>('PUT', `/admin/users/${enc(userId)}/roles`, {
      token,
      body,
    }),

  /** Name and photo of a shared account (Equipo, Invitado). */
  adminProfile: (token: string, userId: string, body: AdminProfileInput) =>
    apiRequest<AdminUser>('PATCH', `/admin/users/${enc(userId)}/profile`, {
      token,
      body,
    }),

  provisionalPassword: (token: string, userId: string) =>
    apiRequest<ProvisionalPasswordResponse>(
      'POST',
      `/admin/users/${enc(userId)}/provisional-password`,
      {token},
    ),

  /** The link itself without a mail transport; nothing (202) when e-mailed. */
  resetLink: (token: string, userId: string) =>
    apiRequest<ResetLinkResponse | null>(
      'POST',
      `/admin/users/${enc(userId)}/reset-link`,
      {token},
    ),

  /** `support.start`. */
  startSupport: (token: string, body: SupportSessionInput) =>
    apiRequest<SupportSessionResponse>('POST', '/admin/support-sessions', {
      token,
      body,
    }),

  /** `view_as_guest`. */
  viewAsGuest: (token: string, body: ViewAsGuestInput) =>
    apiRequest<SupportSessionResponse>('POST', '/admin/view-as-guest', {
      token,
      body,
    }),

  supportSessions: (token: string) =>
    apiRequest<ListResponse<SupportSession>>('GET', '/admin/support-sessions', {
      token,
    }),

  endSupportSession: (token: string, id: string) =>
    apiRequest<void>('DELETE', `/admin/support-sessions/${enc(id)}`, {token}),

  adminSecurity: (token: string) =>
    apiRequest<ListResponse<SecurityEvent>>('GET', '/admin/security', {
      token,
    }),

  removeDemo: (token: string, orgId: string) =>
    apiRequest<{removed: number}>(
      'DELETE',
      `/organizations/${enc(orgId)}/demo`,
      {
        token,
      },
    ),
};
