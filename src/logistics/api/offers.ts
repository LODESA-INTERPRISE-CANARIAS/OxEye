/**
 * Typed wrappers for the Revisión 1 · E6–E7 routes: offer versions, quote
 * requests with personal links, supplier proposals, renewal settings and the
 * public supplier form. Kept apart from `endpoints.ts` so the E6/E7 block
 * can move with the server without touching the rest.
 *
 * Route table (server/src/offer-terms/routes.ts, server/src/quotes/routes.ts):
 *
 *   GET   /organizations/:orgId/offer-versions     current version of every offer
 *   GET   /offers/:id/versions                     every version, newest first
 *   GET   /organizations/:orgId/quote-requests     requests with their links
 *   POST  /quote-requests                          → QuoteRequestCreated
 *   POST  /quote-requests/:id/links                links for more companies
 *   POST  /quote-requests/:id/links/:linkId/renew  a new link (the old one stops)
 *   POST  /quote-requests/:id/close                {version}
 *   GET   /organizations/:orgId/proposals          inbox (directory.read)
 *   POST  /proposals                               recorded by hand
 *   POST  /proposals/:id/approve                   offers.approve
 *   POST  /proposals/:id/reject                    offers.approve
 *   GET   /organizations/:orgId/offer-settings
 *   PATCH /organizations/:orgId/offer-settings     offers.approve
 *   GET   /organizations/:orgId/offer-renewals
 *   POST  /organizations/:orgId/offer-renewals/run  check expiries now
 *   PATCH /offer-renewals/:id                      offers.approve (assignee)
 *
 * Guests get 403 on every one of these. The link addresses exist only in
 * `QuoteRequestCreated.links` and `OfferSettingsResponse.openLinkUrl`.
 *
 * Public, no session, rate limited (429 with Retry-After), bodies ≤ 48 KB.
 * The link token goes in the body, never in the path (proxy logs):
 *
 *   POST  /public/requests/lookup     {token}                → PublicQuoteRequest
 *   POST  /public/requests/proposal   {token, …ProposalInput} → receipt
 *   POST  /public/requests/decline    {token, reason?}       → 204
 *   POST  /public/offers/lookup       {token}                → PublicOpenForm
 *   POST  /public/offers/proposal     {token, …ProposalInput} → receipt
 *
 * An unknown, revoked or expired token answers 404 `LINK_GONE` (the public
 * routes never say which); a link already answered reads `status:
 * 'answered'`.
 */
import type {
  ListResponse,
  ManualProposalInput,
  OfferRenewal,
  OfferRenewalInput,
  OfferSettings,
  OfferSettingsInput,
  OfferSettingsResponse,
  OfferVersion,
  Proposal,
  ProposalApproveInput,
  ProposalApproveResponse,
  ProposalInput,
  ProposalRejectInput,
  PublicOpenForm,
  PublicProposalReceipt,
  PublicQuoteRequest,
  QuoteLinksInput,
  QuoteRequest,
  QuoteRequestCreated,
  QuoteRequestInput,
  SupplierDeclineInput,
  SupplierTokenInput,
} from '../../../shared/logistics/contracts.ts';
import {apiRequest} from './client';

const enc = encodeURIComponent;

/**
 * The public routes, token in the body (`SupplierTokenInput`). Kept in one
 * place so they follow the server's contract if a path changes.
 */
export const PUBLIC_ROUTES = {
  requestLookup: '/public/requests/lookup',
  requestProposal: '/public/requests/proposal',
  requestDecline: '/public/requests/decline',
  openLookup: '/public/offers/lookup',
  openProposal: '/public/offers/proposal',
} as const;

export const offersApi = {
  // ---- E6: versions
  currentVersions: (token: string, orgId: string) =>
    apiRequest<ListResponse<OfferVersion>>(
      'GET',
      `/organizations/${enc(orgId)}/offer-versions`,
      {token},
    ),

  offerVersions: (token: string, offerId: string) =>
    apiRequest<ListResponse<OfferVersion>>(
      'GET',
      `/offers/${enc(offerId)}/versions`,
      {token},
    ),

  // ---- E7: quote requests
  quoteRequests: (token: string, orgId: string) =>
    apiRequest<ListResponse<QuoteRequest>>(
      'GET',
      `/organizations/${enc(orgId)}/quote-requests`,
      {token},
    ),

  createQuoteRequest: (token: string, body: QuoteRequestInput) =>
    apiRequest<QuoteRequestCreated>('POST', '/quote-requests', {token, body}),

  newQuoteLinks: (token: string, id: string, body: QuoteLinksInput) =>
    apiRequest<QuoteRequestCreated>(
      'POST',
      `/quote-requests/${enc(id)}/links`,
      {token, body},
    ),

  renewQuoteLink: (
    token: string,
    id: string,
    linkId: string,
    linkDays?: number,
  ) =>
    apiRequest<QuoteRequestCreated>(
      'POST',
      `/quote-requests/${enc(id)}/links/${enc(linkId)}/renew`,
      {token, body: linkDays ? {linkDays} : {}},
    ),

  closeQuoteRequest: (token: string, id: string, version: number) =>
    apiRequest<QuoteRequest>('POST', `/quote-requests/${enc(id)}/close`, {
      token,
      body: {version},
    }),

  // ---- E7: proposals
  proposals: (token: string, orgId: string) =>
    apiRequest<ListResponse<Proposal>>(
      'GET',
      `/organizations/${enc(orgId)}/proposals`,
      {token},
    ),

  recordProposal: (token: string, body: ManualProposalInput) =>
    apiRequest<Proposal>('POST', '/proposals', {token, body}),

  approveProposal: (token: string, id: string, body: ProposalApproveInput) =>
    apiRequest<ProposalApproveResponse>(
      'POST',
      `/proposals/${enc(id)}/approve`,
      {token, body},
    ),

  rejectProposal: (token: string, id: string, body: ProposalRejectInput) =>
    apiRequest<Proposal>('POST', `/proposals/${enc(id)}/reject`, {
      token,
      body,
    }),

  // ---- E6: renewals and settings
  offerSettings: (token: string, orgId: string) =>
    apiRequest<OfferSettings>(
      'GET',
      `/organizations/${enc(orgId)}/offer-settings`,
      {token},
    ),

  updateOfferSettings: (
    token: string,
    orgId: string,
    body: OfferSettingsInput,
  ) =>
    apiRequest<OfferSettingsResponse>(
      'PATCH',
      `/organizations/${enc(orgId)}/offer-settings`,
      {token, body},
    ),

  renewals: (token: string, orgId: string) =>
    apiRequest<ListResponse<OfferRenewal>>(
      'GET',
      `/organizations/${enc(orgId)}/offer-renewals`,
      {token},
    ),

  runRenewals: (token: string, orgId: string) =>
    apiRequest<{created: number}>(
      'POST',
      `/organizations/${enc(orgId)}/offer-renewals/run`,
      {token},
    ),

  updateRenewal: (token: string, id: string, body: OfferRenewalInput) =>
    apiRequest<OfferRenewal>('PATCH', `/offer-renewals/${enc(id)}`, {
      token,
      body,
    }),

  // ---- E7: public supplier form (no session). The link token travels in
  // the body, never in the path, so no proxy or access log records it.
  publicRequest: (linkToken: string) =>
    apiRequest<PublicQuoteRequest>('POST', PUBLIC_ROUTES.requestLookup, {
      body: {token: linkToken} satisfies SupplierTokenInput,
    }),

  sendRequestProposal: (linkToken: string, body: ProposalInput) =>
    apiRequest<PublicProposalReceipt>('POST', PUBLIC_ROUTES.requestProposal, {
      body: {...body, token: linkToken} satisfies ProposalInput &
        SupplierTokenInput,
    }),

  declineRequest: (linkToken: string, body: SupplierDeclineInput) =>
    apiRequest<void>('POST', PUBLIC_ROUTES.requestDecline, {
      body: {...body, token: linkToken} satisfies SupplierDeclineInput &
        SupplierTokenInput,
    }),

  publicOpenForm: (linkToken: string) =>
    apiRequest<PublicOpenForm>('POST', PUBLIC_ROUTES.openLookup, {
      body: {token: linkToken} satisfies SupplierTokenInput,
    }),

  sendOpenProposal: (linkToken: string, body: ProposalInput) =>
    apiRequest<PublicProposalReceipt>('POST', PUBLIC_ROUTES.openProposal, {
      body: {...body, token: linkToken} satisfies ProposalInput &
        SupplierTokenInput,
    }),
};
