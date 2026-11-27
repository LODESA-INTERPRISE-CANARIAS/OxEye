/**
 * The public supplier page (Revisión 1 · E7): what a company sees when it
 * opens its personal link (or the open «presentar oferta» link). No
 * session, no Gestor: only the organization's name, this request and the
 * guided form. Mobile first.
 *
 * States: opening; the link no longer works (unknown, expired or replaced:
 * the server never says which); already answered or declined; too many
 * attempts (rate limit); no connection (the answers stay on this device);
 * sent («Tu propuesta queda pendiente de revisión»).
 *
 * The answers are kept in this tab while the form is open, so a reload or a
 * dropped connection loses nothing; they are forgotten once sent.
 */
import React, {useCallback, useEffect, useState} from 'react';
import type {
  PublicOpenForm,
  PublicQuoteRequest,
} from '../../../shared/logistics/contracts.ts';
import {DEFAULT_TIMEZONE, utcToLocal} from '../../../shared/logistics/time.ts';
import {isApiError, errorMessage} from '../api/client';
import {offersApi} from '../api/offers';
import {todayIn} from '../lib/format';
import {dayYear, needText} from '../offers/format';
import {Button, ContourTexture, EyeMark, Icon, Spinner} from '../ui';
import {
  draftKeyOf,
  emptyDraft,
  proposalInputOf,
  type ProposalDraft,
  type Problems,
} from './draft';
import {clearSupplierLink, type SupplierLink} from './link';
import {ProposalForm} from './ProposalForm';

const DRAFT_KEY = 'oxeye.logistics.supplier.draft.v1';

type Loaded =
  | {kind: 'request'; data: PublicQuoteRequest}
  | {kind: 'open'; data: PublicOpenForm};

type View =
  | {state: 'loading'}
  | {state: 'gone'}
  | {state: 'limited'; seconds: number | null}
  | {state: 'offline'; message: string}
  | {state: 'ready'; loaded: Loaded}
  | {state: 'sent'; receivedAt: string; organization: string}
  | {state: 'declined'; organization: string};

function readDraft(token: string): ProposalDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as {token?: string; draft?: ProposalDraft};
    return saved.token === token && saved.draft ? saved.draft : null;
  } catch {
    return null;
  }
}

function writeDraft(token: string, draft: ProposalDraft | null): void {
  try {
    if (draft) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({token, draft}));
    } else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private mode: the answers last the page.
  }
}

/** What a failed public call means for the page. */
function failure(err: unknown): View {
  if (isApiError(err)) {
    if (err.status === 404 || err.status === 410) return {state: 'gone'};
    if (err.code === 'RATE_LIMITED') {
      return {state: 'limited', seconds: err.retryAfterSeconds ?? null};
    }
  }
  return {state: 'offline', message: errorMessage(err)};
}

function waitText(seconds: number | null): string {
  if (!seconds) return 'Espera un momento y vuelve a intentarlo.';
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1
    ? 'Espera un minuto y vuelve a intentarlo.'
    : `Espera unos ${minutes} minutos y vuelve a intentarlo.`;
}

export const SupplierApp: React.FC<{link: SupplierLink}> = ({link}) => {
  const today = todayIn(DEFAULT_TIMEZONE);
  const [view, setView] = useState<View>({state: 'loading'});
  const [draft, setDraft] = useState<ProposalDraft | null>(() =>
    readDraft(link.token),
  );
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Problems | undefined>();
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setView({state: 'loading'});
    try {
      const loaded: Loaded =
        link.kind === 'request'
          ? {kind: 'request', data: await offersApi.publicRequest(link.token)}
          : {kind: 'open', data: await offersApi.publicOpenForm(link.token)};
      setView({state: 'ready', loaded});
      setDraft(
        d =>
          d ??
          emptyDraft(
            loaded.kind === 'request' ? loaded.data.company.name : '',
            loaded.kind === 'request' ? loaded.data.need.title : '',
          ),
      );
    } catch (err) {
      setView(failure(err));
    }
  }, [link]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (draft) writeDraft(link.token, draft);
  }, [draft, link.token]);

  useEffect(() => {
    document.title = 'Presupuesto · Ox Eye';
  }, []);

  const organization =
    view.state === 'ready' ? view.loaded.data.organization.name : '';

  const send = async () => {
    if (!draft || busy || view.state !== 'ready') return;
    setBusy(true);
    setSendError(null);
    setProblems(undefined);
    try {
      const body = proposalInputOf(draft, today, {publicForm: true});
      const receipt =
        link.kind === 'request'
          ? await offersApi.sendRequestProposal(link.token, body)
          : await offersApi.sendOpenProposal(link.token, body);
      writeDraft(link.token, null);
      setView({state: 'sent', receivedAt: receipt.receivedAt, organization});
    } catch (err) {
      if (isApiError(err) && err.code === 'VALIDATION' && err.fields) {
        const mapped: Problems = {};
        for (const [k, msg] of Object.entries(err.fields)) {
          mapped[draftKeyOf(k)] = msg;
        }
        setProblems(mapped);
        setSendError(err.message);
      } else {
        const v = failure(err);
        if (v.state === 'offline') {
          setSendError(
            'No se ha podido enviar: sin conexión con el servidor. Tus respuestas siguen aquí; vuelve a pulsar «Enviar» cuando tengas cobertura.',
          );
        } else if (v.state === 'limited') {
          setSendError(`Demasiados intentos. ${waitText(v.seconds)}`);
        } else {
          setView(v);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setSendError(null);
    try {
      await offersApi.declineRequest(link.token, {
        reason: draft.declineReason.trim() || null,
      });
      writeDraft(link.token, null);
      setView({state: 'declined', organization});
    } catch (err) {
      const v = failure(err);
      if (v.state === 'offline') {
        setSendError(
          'No se ha podido enviar: sin conexión con el servidor. Vuelve a intentarlo.',
        );
      } else if (v.state === 'limited') {
        setSendError(`Demasiados intentos. ${waitText(v.seconds)}`);
      } else setView(v);
    } finally {
      setBusy(false);
    }
  };

  let content: React.ReactNode;
  if (view.state === 'loading') {
    content = (
      <div className="lx-supplier__status" role="status">
        <Spinner />
        <p>Abriendo la solicitud…</p>
      </div>
    );
  } else if (view.state === 'gone') {
    content = (
      <End
        icon="link"
        id="lx-supplier-gone"
        title="Este enlace ya no está disponible"
        tone="warn"
      >
        Puede que haya caducado o que se haya creado otro. Si aún quieres enviar
        tu oferta, pide un enlace nuevo a quien te lo envió.
      </End>
    );
  } else if (view.state === 'limited') {
    content = (
      <End
        icon="clock"
        id="lx-supplier-limited"
        title="Demasiados intentos"
        tone="warn"
        action={
          <Button icon="refresh" onClick={() => void load()}>
            Reintentar
          </Button>
        }
      >
        Por seguridad, este enlace se ha pausado un momento.{' '}
        {waitText(view.seconds)}
      </End>
    );
  } else if (view.state === 'offline') {
    content = (
      <End
        icon="cloudOff"
        id="lx-supplier-offline"
        title="Sin conexión"
        tone="warn"
        action={
          <Button icon="refresh" variant="primary" onClick={() => void load()}>
            Reintentar
          </Button>
        }
      >
        No se ha podido abrir la solicitud. Comprueba la cobertura y vuelve a
        intentarlo; si ya habías empezado, tus respuestas siguen guardadas en
        este dispositivo.
      </End>
    );
  } else if (view.state === 'sent') {
    content = (
      <End
        icon="check"
        id="lx-supplier-sent"
        title="Tu propuesta queda pendiente de revisión"
        tone="ok"
        action={
          <Button variant="ghost" onClick={clearSupplierLink}>
            Cerrar
          </Button>
        }
      >
        La ha recibido {view.organization || 'la organización'} el{' '}
        <span className="lx-num">
          {dayYear(utcToLocal(view.receivedAt, DEFAULT_TIMEZONE).date)}
        </span>
        . Una persona de administración la revisará antes de incluirla en su
        catálogo. Si necesitan algo, te escribirán. Ya puedes cerrar esta
        página.
      </End>
    );
  } else if (view.state === 'declined') {
    content = (
      <End
        icon="check"
        id="lx-supplier-declined"
        title="Gracias por avisar"
        tone="ok"
      >
        Le hemos dicho a {view.organization || 'la organización'} que esta vez
        no puedes. Ya puedes cerrar esta página.
      </End>
    );
  } else {
    const loaded = view.loaded;
    if (loaded.kind === 'request' && loaded.data.status !== 'open') {
      content = (
        <End
          icon="check"
          id="lx-supplier-used"
          title={
            loaded.data.status === 'answered'
              ? 'Ya has respondido a esta solicitud'
              : 'Ya indicaste que no puedes'
          }
          tone="ok"
        >
          {loaded.data.status === 'answered'
            ? 'Tu propuesta queda pendiente de revisión. Este enlace solo sirve para una respuesta; si quieres cambiar algo, escribe a quien te lo envió.'
            : 'Gracias por avisar. Si cambias de idea, pide un enlace nuevo a quien te lo envió.'}
        </End>
      );
    } else if (draft) {
      content = (
        <>
          {sendError && (
            <p
              className="lx-notice lx-notice--error"
              role="alert"
              id="lx-supplier-error"
            >
              <Icon name="alert" size={18} />
              <span>{sendError}</span>
            </p>
          )}
          <ProposalForm
            mode={link.kind}
            draft={draft}
            onDraft={setDraft}
            today={today}
            intro={
              loaded.kind === 'request' ? (
                <RequestCard request={loaded.data} />
              ) : undefined
            }
            serverProblems={problems}
            busy={busy}
            onSend={() => void send()}
            onDecline={() => void decline()}
            idPrefix="lx-sf"
          />
        </>
      );
    }
  }

  return (
    <div className="lx-supplier" id="lx-supplier" data-state={view.state}>
      <ContourTexture />
      <header className="lx-supplier__bar">
        <EyeMark size={30} />
        <div className="lx-supplier__brand">
          <strong>{organization || 'Petición de presupuesto'}</strong>
          <span>con Ox Eye</span>
        </div>
      </header>
      <main className="lx-supplier__card">{content}</main>
      <footer className="lx-supplier__foot">
        Solo la organización que te envió el enlace verá tus respuestas.
      </footer>
    </div>
  );
};

/** What is asked: shown above the first question. */
const RequestCard: React.FC<{request: PublicQuoteRequest}> = ({request}) => {
  const until = utcToLocal(request.expiresAt, DEFAULT_TIMEZONE).date;
  return (
    <section
      className="lx-sf__asked"
      id="lx-supplier-request"
      aria-label="Lo que se pide"
    >
      <p className="lx-eyebrow">
        {request.organization.name} pide presupuesto a {request.company.name}
      </p>
      <p className="lx-sf__asked-title">{request.need.title}</p>
      <p className="lx-sf__asked-need lx-num">
        {needText(request.need)}
        {request.need.categoryName ? ` · ${request.need.categoryName}` : ''}
      </p>
      {request.need.note && (
        <p className="lx-sf__asked-note">{request.need.note}</p>
      )}
      <p className="lx-sf__asked-meta">
        <Icon name="clock" size={15} />
        <span>
          Puedes responder hasta el{' '}
          <span className="lx-num">{dayYear(until)}</span>. Unos 5 minutos.
        </span>
      </p>
    </section>
  );
};

const End: React.FC<{
  icon: 'check' | 'link' | 'clock' | 'cloudOff';
  id: string;
  title: string;
  tone: 'ok' | 'warn';
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({icon, id, title, tone, action, children}) => (
  <section
    className="lx-supplier__end"
    id={id}
    data-tone={tone}
    aria-labelledby={`${id}-title`}
  >
    <span className="lx-supplier__end-icon" aria-hidden="true">
      <Icon name={icon} size={28} />
    </span>
    <h1 className="lx-sf__title" id={`${id}-title`}>
      {title}
    </h1>
    <p className="lx-sf__text">{children}</p>
    {action && <div className="lx-supplier__end-actions">{action}</div>}
  </section>
);
