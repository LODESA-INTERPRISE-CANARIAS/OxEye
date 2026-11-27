/**
 * «Renovaciones» (Revisión 1 · E6): OxEye creates a renegotiation task
 * before an offer can no longer be accepted, so nobody plans an event on a
 * price that no longer holds. The task is assigned to whoever approved the
 * offer (administrators may change it). Expired offers stay as history and
 * are never compared as current.
 *
 * Administrators also set how early the tasks appear (15/30/60/90 days) and
 * whether the open «presentar oferta» form exists (off by default).
 */
import React, {useMemo, useState} from 'react';
import type {
  Offer,
  OfferRenewal,
  OfferSettings,
} from '../../../shared/logistics/contracts.ts';
import {NO_ACCESS} from '../../../shared/logistics/permissions.ts';
import {RENEWAL_NOTICE_OPTIONS} from '../../../shared/logistics/offer-terms.ts';
import {daysBetween} from '../../../shared/logistics/time.ts';
import {errorMessage, isApiError} from '../api/client';
import {offersApi} from '../api/offers';
import {useAccess} from '../account/useAccess';
import {useMembers} from '../account/members';
import {useActions} from '../common/actions';
import {instantShort, plural} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Chip,
  EmptyState,
  EyeMark,
  HelpTip,
  Icon,
  LoadError,
  Segmented,
  SelectField,
  SkeletonRows,
} from '../ui';
import {
  openOrgId,
  sessionToken,
  storeRenewal,
  storeSettings,
  useCurrentVersions,
  useOfferSettings,
  useRenewals,
} from './data';
import {dayYear, priceText, VERSION_STATUS_LABEL} from './format';
import {RequestSheet, type RequestPrefill} from './RequestSheet';
import {copyText} from '../lib/clipboard';
import {LocalLinkWarning, urlToShare} from './ShareLinks';

export const RenewalsView: React.FC = () => {
  const {today, timeZone, canWrite, openTask, openOffer} = useActions();
  const access = useAccess();
  const isAdmin = access.can('offers.approve');
  const renewals = useRenewals();
  const versions = useCurrentVersions();
  const offers = useLogisticsStore(s => s.offers);
  const tasks = useLogisticsStore(s => s.tasks);
  const [request, setRequest] = useState<RequestPrefill | null>(null);

  const open = useMemo(
    () =>
      (renewals.data ?? [])
        .filter(r => !r.resolvedAt)
        .sort((a, b) => a.acceptUntil.localeCompare(b.acceptUntil)),
    [renewals.data],
  );
  const resolved = useMemo(
    () =>
      (renewals.data ?? [])
        .filter(r => r.resolvedAt)
        .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '')),
    [renewals.data],
  );
  const expired = useMemo(
    () =>
      (versions.data ?? [])
        .filter(v => v.status === 'expired')
        .map(v => ({version: v, offer: offers.find(o => o.id === v.offerId)}))
        .filter(
          (x): x is {version: typeof x.version; offer: Offer} => !!x.offer,
        ),
    [versions.data, offers],
  );

  const renegotiate = (r: OfferRenewal) => {
    const offer = offers.find(o => o.id === r.offer.id);
    setRequest({
      renegotiate: true,
      offerId: r.offer.id,
      title: r.offer.name,
      categoryId: offer?.categoryId ?? null,
      companyIds: [r.company.id],
      note: `Tu precio actual (versión ${r.versionNumber}) se puede aceptar hasta el ${dayYear(r.acceptUntil)}. ¿Nos indicas las condiciones para el próximo periodo?`,
    });
  };

  let list: React.ReactNode;
  if (renewals.state === 'loading' && !renewals.data) {
    list = <SkeletonRows rows={3} label="Cargando las renovaciones" />;
  } else if (renewals.state === 'error' && !renewals.data) {
    list = renewals.unsupported ? (
      <EmptyState icon="server" title="Aún no disponible" compact>
        El servidor todavía no tiene las renovaciones.
      </EmptyState>
    ) : (
      <LoadError message={renewals.error ?? ''} onRetry={renewals.reload} />
    );
  } else if (!open.length) {
    list = (
      <EmptyState
        compact
        icon="check"
        title="Nada por renegociar"
        id="lx-renewals-empty"
      >
        Cuando a una oferta le queden menos días que el aviso, OxEye creará
        aquí la tarea de renegociarla.
      </EmptyState>
    );
  } else {
    list = (
      <ul className="lx-renewals" id="lx-renewals-list">
        {open.map(r => {
          const left = daysBetween(today, r.acceptUntil);
          const offer = offers.find(o => o.id === r.offer.id);
          const version = versions.data?.find(v => v.offerId === r.offer.id);
          const task = r.taskId
            ? tasks.find(t => t.id === r.taskId)
            : undefined;
          return (
            <li
              key={r.id}
              className="lx-card lx-renewal"
              data-renewal-id={r.id}
              data-urgent={left <= 15 || undefined}
            >
              <div className="lx-renewal__head">
                <span className="lx-renewal__days lx-num" aria-hidden="true">
                  <strong>{Math.max(0, left)}</strong>
                  <span>{left === 1 ? 'día' : 'días'}</span>
                </span>
                <div className="lx-renewal__text">
                  <h3>
                    {r.company.name} · {r.offer.name}
                  </h3>
                  <p className="lx-num">
                    {left < 0
                      ? `Caducó el ${dayYear(r.acceptUntil)}`
                      : left === 0
                        ? 'Se puede aceptar hasta hoy'
                        : `Se puede aceptar hasta el ${dayYear(r.acceptUntil)} · quedan ${plural(left, 'día', 'días')}`}
                    {version && priceText(version.terms)
                      ? ` · v${r.versionNumber}: ${priceText(version.terms)}`
                      : ` · versión ${r.versionNumber}`}
                  </p>
                </div>
              </div>
              <div className="lx-renewal__foot">
                <span className="lx-signed">
                  <EyeMark size={18} /> Generada por OxEye ·{' '}
                  <span className="lx-num">
                    {instantShort(r.generatedAt, timeZone)}
                  </span>
                  {' · '}
                  {plural(r.noticeDays, 'día', 'días')} de aviso
                </span>
                <Assignee renewal={r} editable={isAdmin} />
              </div>
              <div className="lx-renewal__actions">
                {canWrite && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon="send"
                    data-action="renegotiate"
                    onClick={() => renegotiate(r)}
                  >
                    Pedir precio nuevo
                  </Button>
                )}
                {task && (
                  <Button size="sm" icon="task" onClick={() => openTask(task)}>
                    Abrir la tarea
                  </Button>
                )}
                {offer && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="offer"
                    onClick={() => openOffer(offer)}
                  >
                    Ver oferta
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="lx-offersview" id="lx-renewals">
      <h2 className="lx-offersview__title">
        Por renegociar
        {open.length > 0 && (
          <span className="lx-count lx-num">{open.length}</span>
        )}
      </h2>
      {list}
      {resolved.length > 0 && (
        <>
          <h2 className="lx-offersview__title">Resueltas</h2>
          <ul className="lx-apartlist" id="lx-renewals-resolved">
            {resolved.map(r => (
              <li key={r.id}>
                <span>
                  <strong>
                    {r.company.name} · {r.offer.name}
                  </strong>
                  <span className="lx-muted lx-num">
                    v{r.versionNumber} → v{r.resolvedByVersion ?? '?'} ·{' '}
                    {r.resolvedAt ? instantShort(r.resolvedAt, timeZone) : ''}
                  </span>
                </span>
                <Chip size="sm" certainty="confirmed">
                  Renovada
                </Chip>
              </li>
            ))}
          </ul>
        </>
      )}
      {expired.length > 0 && (
        <>
          <h2 className="lx-offersview__title">
            Caducadas · historial
            <HelpTip label="ofertas caducadas">
              Pasada la fecha hasta la que se podían aceptar, se guardan en el
              historial y nunca se comparan ni se usan como tarifa vigente.
            </HelpTip>
          </h2>
          <ul className="lx-apartlist" id="lx-renewals-expired">
            {expired.map(({version, offer}) => (
              <li key={version.id}>
                <button
                  type="button"
                  className="lx-apartlist__row"
                  onClick={() => openOffer(offer)}
                >
                  <span>
                    <strong>
                      {offer.company.name} · {offer.name}
                    </strong>
                    <span className="lx-muted lx-num">
                      v{version.number} ·{' '}
                      {priceText(version.terms) ?? 'sin precio'}
                      {version.terms.acceptUntil &&
                        ` · caducó el ${dayYear(version.terms.acceptUntil)}`}
                    </span>
                  </span>
                  <Chip size="sm" tag tone="neutral">
                    {VERSION_STATUS_LABEL.expired}
                  </Chip>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {/* What to renegotiate comes first; the settings are set once. */}
      <SettingsCard isAdmin={isAdmin} />
      {request && (
        <RequestSheet prefill={request} onClose={() => setRequest(null)} />
      )}
    </div>
  );
};

/** Who renegotiates: a select for administrators, the name for the rest. */
const Assignee: React.FC<{renewal: OfferRenewal; editable: boolean}> = ({
  renewal,
  editable,
}) => {
  const members = useMembers();
  const toast = useLogisticsStore(s => s.toast);
  const [busy, setBusy] = useState(false);
  const options = useMemo(
    () =>
      [...members.byId.values()]
        .filter(m => m.role === 'member' && !m.restricted)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'))
        .map(m => ({value: m.id, label: m.displayName})),
    [members.byId],
  );
  const id = `lx-renewal-assignee-${renewal.id}`;
  if (!editable || !options.length) {
    return (
      <span className="lx-renewal__assignee">
        <Icon name="user" size={15} />
        {renewal.assignee?.displayName ?? 'Sin asignar'}
      </span>
    );
  }
  return (
    <span className="lx-renewal__assignee">
      <label htmlFor={id} className="lx-visually-hidden">
        Quién la renegocia
      </label>
      <SelectField
        id={id}
        value={renewal.assignee?.id ?? ''}
        emptyLabel="Sin asignar"
        options={
          renewal.assignee &&
          !options.some(o => o.value === renewal.assignee?.id)
            ? [
                {
                  value: renewal.assignee.id,
                  label: renewal.assignee.displayName,
                },
                ...options,
              ]
            : options
        }
        disabled={busy}
        onChange={async v => {
          const token = sessionToken();
          if (!token) return;
          setBusy(true);
          try {
            const res = await offersApi.updateRenewal(token, renewal.id, {
              assigneeId: v || null,
              version: renewal.version,
            });
            storeRenewal(res);
            toast(
              res.assignee
                ? `La renegocia ${res.assignee.displayName}`
                : 'Renegociación sin asignar',
              'success',
            );
          } catch (err) {
            toast(
              isApiError(err) && err.code === 'FORBIDDEN'
                ? NO_ACCESS['offers.approve']
                : errorMessage(err),
              'error',
            );
          } finally {
            setBusy(false);
          }
        }}
      />
    </span>
  );
};

/** Notice period and the open form: administrators change them. */
const SettingsCard: React.FC<{isAdmin: boolean}> = ({isAdmin}) => {
  const settings = useOfferSettings();
  const toast = useLogisticsStore(s => s.toast);
  const [busy, setBusy] = useState(false);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const s = settings.data;

  const save = async (
    patch: Omit<Parameters<typeof offersApi.updateOfferSettings>[2], 'version'>,
  ) => {
    const token = sessionToken();
    const orgId = openOrgId();
    if (!token || !orgId || !s || busy) return;
    setBusy(true);
    try {
      const res = await offersApi.updateOfferSettings(token, orgId, {
        ...patch,
        version: s.version,
      });
      storeSettings(res.settings);
      if (res.openLinkUrl) setOpenUrl(urlToShare(res.openLinkUrl));
      if (patch.openLinkEnabled === false) setOpenUrl(null);
      return res.settings;
    } catch (err) {
      if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        settings.reload();
        toast('Otra persona ha cambiado los ajustes: revísalos.', 'error');
      } else {
        toast(
          isApiError(err) && err.code === 'FORBIDDEN'
            ? NO_ACCESS['offers.approve']
            : errorMessage(err),
          'error',
        );
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="lx-card lx-offersettings"
      id="lx-offer-settings"
      aria-labelledby="lx-offer-settings-title"
    >
      <div className="lx-offersettings__text">
        <h2 className="lx-card__title" id="lx-offer-settings-title">
          Avisos de renovación
        </h2>
        <p>
          OxEye revisa las ofertas cada día y crea una tarea cuando a una le
          quedan menos días que este aviso, asignada a quien la aprobó.
        </p>
      </div>
      {!s ? (
        settings.state === 'error' ? (
          <p className="lx-muted">{settings.error}</p>
        ) : (
          <SkeletonRows rows={1} label="Cargando los ajustes" />
        )
      ) : (
        <>
          <Segmented<string>
            name="lx-notice-days"
            id="lx-notice-days"
            legend="Crear la tarea con una antelación de"
            value={String(s.renewalNoticeDays)}
            options={RENEWAL_NOTICE_OPTIONS.map(d => ({
              value: String(d),
              label: `${d} días`,
            }))}
            disabled={!isAdmin || busy}
            onChange={async v => {
              if (!v) return;
              const saved = await save({renewalNoticeDays: Number(v)});
              if (saved) {
                toast(
                  `Aviso a ${saved.renewalNoticeDays} días · para todas las ofertas`,
                  'success',
                );
              }
            }}
          />
          {!isAdmin && (
            <p className="lx-field__hint">
              <Icon name="lock" size={14} /> Solo administración cambia estos
              ajustes.
            </p>
          )}
          <OpenLinkSetting
            settings={s}
            isAdmin={isAdmin}
            busy={busy}
            url={openUrl}
            confirmRotate={confirmRotate}
            onConfirmRotate={setConfirmRotate}
            onToggle={async enabled => {
              const saved = await save({openLinkEnabled: enabled});
              if (saved) {
                toast(
                  enabled
                    ? 'Formulario abierto activado: comparte el enlace'
                    : 'Formulario abierto desactivado: el enlace ya no funciona',
                  'success',
                );
              }
            }}
            onRotate={async () => {
              const saved = await save({rotateOpenLink: true});
              setConfirmRotate(false);
              if (saved) {
                toast('Enlace nuevo: el anterior ya no funciona', 'success');
              }
            }}
            onCopy={async () => {
              if (!openUrl) return;
              const ok = await copyText(openUrl);
              toast(
                ok
                  ? 'Enlace copiado'
                  : 'No se ha podido copiar: cópialo a mano.',
                ok ? 'success' : 'error',
              );
            }}
          />
        </>
      )}
    </section>
  );
};

const OpenLinkSetting: React.FC<{
  settings: OfferSettings;
  isAdmin: boolean;
  busy: boolean;
  url: string | null;
  confirmRotate: boolean;
  onConfirmRotate: (v: boolean) => void;
  onToggle: (enabled: boolean) => void;
  onRotate: () => void;
  onCopy: () => void;
}> = ({
  settings,
  isAdmin,
  busy,
  url,
  confirmRotate,
  onConfirmRotate,
  onToggle,
  onRotate,
  onCopy,
}) => {
  const on = settings.openLink.enabled;
  return (
    <div className="lx-openlink" id="lx-open-link">
      <Segmented<'off' | 'on'>
        name="lx-open-link"
        legend="Formulario abierto «Presentar oferta»"
        value={on ? 'on' : 'off'}
        options={[
          {value: 'off', label: 'Desactivado'},
          {value: 'on', label: 'Activado'},
        ]}
        disabled={!isAdmin || busy}
        help="Un enlace que no es de ninguna empresa: cualquiera que lo tenga puede presentar una oferta. Todas quedan pendientes de un administrador. Desactívalo y el enlace deja de funcionar."
        onChange={v => v && onToggle(v === 'on')}
      />
      {on && url && (
        <div className="lx-openlink__url">
          <LocalLinkWarning id="lx-open-link-local" />
          <p className="lx-field__hint">
            Este es el único momento en que se ve el enlace: cópialo ahora.
          </p>
          <code className="lx-sharelink__url" translate="no">
            {url}
          </code>
          <Button size="sm" icon="copy" onClick={onCopy} id="lx-open-link-copy">
            Copiar enlace
          </Button>
        </div>
      )}
      {on && !url && (
        <p className="lx-field__hint">
          Activado
          {settings.openLink.createdAt
            ? ` desde el ${dayYear(settings.openLink.createdAt.slice(0, 10))}`
            : ''}
          . El enlace no se puede volver a mostrar; si lo has perdido, crea uno
          nuevo.
        </p>
      )}
      {on &&
        isAdmin &&
        (confirmRotate ? (
          <div className="lx-confirm-strip">
            <p>El enlace actual dejará de funcionar para quien lo tenga.</p>
            <div className="lx-confirm-strip__actions">
              <Button onClick={() => onConfirmRotate(false)}>Volver</Button>
              <Button
                variant="primary"
                busy={busy}
                id="lx-open-link-rotate-confirm"
                onClick={onRotate}
              >
                Crear enlace nuevo
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            id="lx-open-link-rotate"
            onClick={() => onConfirmRotate(true)}
          >
            Crear un enlace nuevo
          </Button>
        ))}
    </div>
  );
};
