/**
 * Typed wrappers for the routes listed in `shared/logistics/contracts.ts`.
 */
import type {
  ActivityEntry,
  Category,
  CategoryInput,
  Company,
  CompanyInput,
  Contact,
  ContactInput,
  CreateEventInput,
  HealthResponse,
  ListResponse,
  LoginRequest,
  LoginResponse,
  LoginUserOption,
  LogisticsEvent,
  MeResponse,
  Offer,
  OfferInput,
  RecentSearch,
  RecentSearchInput,
  Task,
  TaskInput,
  UpdateEventInput,
  Venue,
} from '../../../shared/logistics/contracts.ts';
import {apiRequest} from './client';

const enc = encodeURIComponent;

export const api = {
  health: (signal?: AbortSignal) =>
    apiRequest<HealthResponse>('GET', '/health', {signal}),

  loginUsers: () =>
    apiRequest<ListResponse<LoginUserOption>>('GET', '/auth/users'),

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

  removeDemo: (token: string, orgId: string) =>
    apiRequest<{removed: number}>(
      'DELETE',
      `/organizations/${enc(orgId)}/demo`,
      {
        token,
      },
    ),
};
