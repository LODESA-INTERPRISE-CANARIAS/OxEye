/**
 * Typed wrappers for the routes listed in `shared/logistics/contracts.ts`.
 */
import type {
  ActivityEntry,
  Company,
  CreateEventInput,
  HealthResponse,
  ListResponse,
  LoginRequest,
  LoginResponse,
  LoginUserOption,
  LogisticsEvent,
  MeResponse,
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
