/**
 * «Fotos» of a resource (Revisión 1 · E3): the photo being looked at, large,
 * with who took it; a strip with the others (main first); and, for members,
 * «Hacer foto» / «Añadir foto», «Hacer principal» and «Quitar» (asks first).
 *
 * - Photos are prepared on the device before they leave it (upright, about
 *   1600 px, JPEG under 400 KB, no GPS or camera metadata).
 * - Without coverage a new photo waits in the outbox («Pendiente de enviar»)
 *   and shows from the device; making a photo main or removing one needs the
 *   server.
 * - Guests see the photos (they show the material, nobody's data) but none
 *   of the actions.
 */
import React, {useMemo, useRef, useState} from 'react';
import type {MediaInfo, Resource} from '../../../shared/logistics/contracts.ts';
import {MEDIA_PER_RECORD} from '../../../shared/logistics/rules.ts';
import {errorMessage, isApiError} from '../api/client';
import {relativeTime} from '../lib/format';
import {UnsentMark} from '../offline/PendingMark';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, HelpTip, Icon} from '../ui';
import {forgetMedia, useMediaSrc} from './media-cache';
import {
  categoryIcon,
  photoRoom,
  queuedPhotos,
  sortMedia,
  type QueuedPhoto,
} from './media';
import {PhotoError, preparePhoto} from './photo-prepare';

const HELP = `Fotos del material, para reconocerlo en el almacén y en el montaje. Se reducen en este mismo dispositivo antes de enviarse (unos 1600 píxeles, sin la ubicación GPS ni los datos de la cámara). La principal es la que se ve en las listas. Hasta ${MEDIA_PER_RECORD} por material. Una foto ayuda a reconocer el material: no sustituye al recuento ni a las medidas.`;

type Item =
  | {kind: 'stored'; id: string; media: MediaInfo}
  | {kind: 'waiting'; id: string; photo: QueuedPhoto};

/**
 * What went wrong with an upload, in the server's words: a photo has no form
 * field to mark, so the field message (too big, not an image…) is the one.
 */
function photoProblem(err: unknown): string {
  if (isApiError(err) && err.fields) {
    const first = Object.values(err.fields)[0];
    if (first) return first;
  }
  return errorMessage(err);
}

/** Phones and tablets get «Hacer foto» (camera) next to the gallery. */
function hasCamera(): boolean {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  } catch {
    return false;
  }
}

export const ResourcePhotos: React.FC<{
  resource: Resource;
  categoryName: string | null | undefined;
  /** False once the resource no longer exists. */
  canEdit: boolean;
  canWrite: boolean;
}> = ({resource: r, categoryName, canEdit, canWrite}) => {
  const outbox = useLogisticsStore(s => s.outbox);
  const online = useLogisticsStore(
    s => s.connection === 'online' && !s.fromCache,
  );
  const timeZone = useLogisticsStore(
    s => s.organizations.find(o => o.id === s.orgId)?.timezone,
  );
  const addResourcePhoto = useLogisticsStore(s => s.addResourcePhoto);
  const setMainPhoto = useLogisticsStore(s => s.setMainPhoto);
  const deletePhoto = useLogisticsStore(s => s.deletePhoto);
  const discardEntry = useLogisticsStore(s => s.discardEntry);
  const retryEntry = useLogisticsStore(s => s.retryEntry);
  const toast = useLogisticsStore(s => s.toast);

  const stored = useMemo(() => sortMedia(r.media ?? []), [r.media]);
  const waiting = useMemo(() => queuedPhotos(outbox, r.id), [outbox, r.id]);
  const items: Item[] = useMemo(
    () => [
      ...stored.map(m => ({kind: 'stored' as const, id: m.id, media: m})),
      ...waiting.map(p => ({kind: 'waiting' as const, id: p.id, photo: p})),
    ],
    [stored, waiting],
  );
  const room = photoRoom(stored.length, waiting.length);
  const members = canWrite && canEdit;

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    'main' | 'remove' | 'discard' | 'retry' | null
  >(null);
  const [adding, setAdding] = useState<{done: number; total: number} | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [camera] = useState(hasCamera);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const current = items.find(i => i.id === pickedId) ?? items[0] ?? null;
  const index = current ? items.indexOf(current) : -1;

  const pick = (id: string) => {
    setPickedId(id);
    setConfirming(null);
    setProblem(null);
  };

  const addFiles = async (files: FileList | null) => {
    const all = files ? [...files] : [];
    if (!all.length) return;
    const list = all.slice(0, room);
    const left = all.length - list.length;
    setProblem(null);
    setConfirming(null);
    setAdding({done: 0, total: list.length});
    const problems: string[] = [];
    let added = 0;
    let queued = 0;
    for (const [i, file] of list.entries()) {
      try {
        const prepared = await preparePhoto(file);
        const res = await addResourcePhoto(r, {
          contentType: prepared.contentType,
          width: prepared.width,
          height: prepared.height,
          data: prepared.data,
        });
        if (res.queued) queued++;
        else added++;
        setPickedId(res.id);
      } catch (err) {
        problems.push(
          err instanceof PhotoError ? err.message : photoProblem(err),
        );
      }
      setAdding({done: i + 1, total: list.length});
    }
    setAdding(null);
    if (left > 0) {
      problems.push(
        `Caben ${MEDIA_PER_RECORD} fotos por material: ${
          left === 1
            ? 'una se ha quedado fuera'
            : `${left} se han quedado fuera`
        }.`,
      );
    }
    if (problems.length) setProblem([...new Set(problems)].join(' '));
    if (queued) {
      toast(
        queued === 1
          ? 'Foto guardada en este dispositivo: se enviará al volver la conexión.'
          : `${queued} fotos guardadas en este dispositivo: se enviarán al volver la conexión.`,
        'info',
      );
    } else if (added) {
      toast(
        added === 1
          ? `Foto añadida a «${r.name}».`
          : `${added} fotos añadidas a «${r.name}».`,
        'success',
      );
    }
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    void addFiles(files).finally(() => {
      // The same photo may be chosen again later.
      e.target.value = '';
    });
  };

  const run = async (
    kind: 'main' | 'remove' | 'discard' | 'retry',
    action: () => Promise<void>,
    done?: string,
  ) => {
    setBusy(kind);
    setProblem(null);
    try {
      await action();
      setConfirming(null);
      if (done) toast(done, 'success');
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const addButtons = members && room > 0 && (
    <div className="lx-photos__add">
      {camera && (
        <Button
          size="sm"
          icon="camera"
          id="lx-resource-photo-camera-btn"
          busy={!!adding}
          disabled={!!adding}
          onClick={() => cameraInput.current?.click()}
        >
          Hacer foto
        </Button>
      )}
      <Button
        size="sm"
        variant={camera ? 'ghost' : 'secondary'}
        icon={camera ? undefined : 'plus'}
        id="lx-resource-photo-add"
        busy={!camera && !!adding}
        disabled={!!adding}
        onClick={() => fileInput.current?.click()}
      >
        {camera ? 'Desde la galería' : 'Añadir foto'}
      </Button>
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        id="lx-resource-photo-camera"
        onChange={onPicked}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        id="lx-resource-photo-file"
        onChange={onPicked}
      />
    </div>
  );

  return (
    <section
      className="lx-subsection lx-photos"
      id="lx-resource-photos"
      aria-labelledby="lx-resource-photos-title"
    >
      <div className="lx-subsection__head">
        <h3 className="lx-subsection__title" id="lx-resource-photos-title">
          Fotos
          <span className="lx-count lx-num" id="lx-resource-photos-count">
            {items.length}/{MEDIA_PER_RECORD}
          </span>
          <HelpTip label="fotos del material">{HELP}</HelpTip>
        </h3>
        {items.length > 0 && addButtons}
      </div>

      {adding && (
        <p
          className="lx-photos__progress"
          role="status"
          id="lx-resource-photos-progress"
        >
          <span className="lx-spinner lx-spinner--inline" aria-hidden="true" />
          {adding.total === 1
            ? 'Preparando y enviando la foto…'
            : `Preparando y enviando ${Math.min(adding.done + 1, adding.total)} de ${adding.total}…`}
        </p>
      )}
      {problem && (
        <p
          className="lx-photos__problem"
          role="alert"
          id="lx-resource-photos-problem"
        >
          <Icon name="alert" size={16} />
          <span>{problem}</span>
        </p>
      )}

      {!current ? (
        <div className="lx-photos__empty" id="lx-resource-photos-empty">
          <span className="lx-thumb lx-thumb--lg" aria-hidden="true">
            <Icon name={categoryIcon(categoryName)} size={30} />
          </span>
          <div className="lx-photos__empty-text">
            <p className="lx-photos__empty-title">Sin fotos todavía</p>
            <p className="lx-muted">
              {members
                ? 'Una foto ayuda a reconocer el material en el almacén y en el montaje.'
                : 'Cuando el equipo añada fotos de este material, aparecerán aquí.'}
            </p>
            {addButtons}
          </div>
        </div>
      ) : (
        <>
          <figure className="lx-photos__stage" id="lx-resource-photo-stage">
            {current.kind === 'stored' ? (
              <StoredImage media={current.media} alt={`Foto de ${r.name}`} />
            ) : (
              <img
                src={current.photo.src}
                alt={`Foto de ${r.name} (aún en este dispositivo)`}
              />
            )}
            <figcaption className="lx-photos__caption">
              <span className="lx-photos__caption-text">
                {current.kind === 'stored' && current.media.main && (
                  <span className="lx-photos__main" id="lx-resource-photo-main">
                    <Icon name="check" size={13} />
                    Principal
                  </span>
                )}
                {current.kind === 'stored' ? (
                  <span className="lx-num">
                    Foto de {current.media.createdBy.displayName} ·{' '}
                    {relativeTime(current.media.createdAt, timeZone)}
                  </span>
                ) : (
                  <UnsentMark id={current.id} />
                )}
              </span>
              {items.length > 1 && (
                <span className="lx-muted lx-num" aria-hidden="true">
                  {index + 1} de {items.length}
                </span>
              )}
            </figcaption>
          </figure>

          {/* The strip sits right under the photo it switches. */}
          {items.length > 1 && (
            <ul className="lx-photos__strip" aria-label="Fotos del material">
              {items.map((item, i) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="lx-photos__pick"
                    aria-pressed={item.id === current.id}
                    aria-label={[
                      `Foto ${i + 1} de ${items.length}`,
                      item.kind === 'stored' && item.media.main
                        ? 'principal'
                        : '',
                      item.kind === 'waiting' ? 'pendiente de enviar' : '',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    data-photo-id={item.id}
                    onClick={() => pick(item.id)}
                  >
                    {item.kind === 'stored' ? (
                      <StoredImage media={item.media} alt="" small />
                    ) : (
                      <img src={item.photo.src} alt="" />
                    )}
                    {item.kind === 'stored' && item.media.main && (
                      <span className="lx-photos__pick-main" aria-hidden="true">
                        <Icon name="check" size={11} />
                      </span>
                    )}
                    {item.kind === 'waiting' && (
                      <span
                        className="lx-photos__pick-wait"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {current.kind === 'waiting' && current.photo.state === 'refused' && (
            <p className="lx-photos__problem" id="lx-resource-photo-refused">
              <Icon name="alert" size={16} />
              <span>
                No se ha enviado:{' '}
                {current.photo.error ?? 'el servidor no la aceptó.'}
              </span>
            </p>
          )}

          {members &&
            (confirming === current.id ? (
              <div
                className="lx-photos__confirm"
                role="group"
                aria-labelledby="lx-resource-photo-confirm-q"
                id="lx-resource-photo-confirm"
              >
                <p id="lx-resource-photo-confirm-q">
                  <strong>
                    {current.kind === 'stored'
                      ? '¿Quitar esta foto?'
                      : '¿Descartar esta foto?'}
                  </strong>{' '}
                  {current.kind === 'stored'
                    ? 'Desaparece de la ficha para todo el equipo. No se puede deshacer.'
                    : 'Aún no ha llegado al servidor: se borrará de este dispositivo.'}
                </p>
                <div className="lx-photos__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    id="lx-resource-photo-keep"
                    onClick={() => setConfirming(null)}
                  >
                    Conservar
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon="trash"
                    data-autofocus
                    id="lx-resource-photo-remove-yes"
                    busy={busy === 'remove' || busy === 'discard'}
                    onClick={() =>
                      current.kind === 'stored'
                        ? void run(
                            'remove',
                            async () => {
                              await deletePhoto(r, current.media);
                              forgetMedia(current.media.id);
                              setPickedId(null);
                            },
                            `Foto quitada de «${r.name}».`,
                          )
                        : void run('discard', async () => {
                            await discardEntry(current.photo.entryId);
                            setPickedId(null);
                          })
                    }
                  >
                    {current.kind === 'stored'
                      ? 'Quitar foto'
                      : 'Descartar foto'}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="lx-photos__actions"
                id="lx-resource-photo-actions"
              >
                {current.kind === 'stored' && !current.media.main && (
                  <Button
                    size="sm"
                    icon="check"
                    id="lx-resource-photo-make-main"
                    busy={busy === 'main'}
                    disabled={!online || !!busy}
                    onClick={() =>
                      void run(
                        'main',
                        () => setMainPhoto(r, current.media),
                        'Foto principal cambiada: es la que se ve en las listas.',
                      )
                    }
                  >
                    Hacer principal
                  </Button>
                )}
                {current.kind === 'waiting' &&
                  current.photo.state === 'refused' && (
                    <Button
                      size="sm"
                      icon="refresh"
                      id="lx-resource-photo-retry"
                      busy={busy === 'retry'}
                      disabled={!online || !!busy}
                      onClick={() =>
                        void run('retry', () =>
                          retryEntry(current.photo.entryId),
                        )
                      }
                    >
                      Reintentar
                    </Button>
                  )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  className="lx-btn--danger-text"
                  id="lx-resource-photo-remove"
                  disabled={(current.kind === 'stored' && !online) || !!busy}
                  onClick={() => setConfirming(current.id)}
                >
                  {current.kind === 'stored' ? 'Quitar' : 'Descartar'}
                </Button>
                {!online && current.kind === 'stored' && (
                  <span className="lx-muted lx-photos__hint">
                    Hacer principal y quitar necesitan conexión.
                  </span>
                )}
              </div>
            ))}
        </>
      )}
    </section>
  );
};

/** A stored photo, fetched with the session; placeholders while it loads. */
const StoredImage: React.FC<{
  media: MediaInfo;
  alt: string;
  small?: boolean;
}> = ({media, alt, small = false}) => {
  const {src, state} = useMediaSrc(media.id);
  if (src) {
    return (
      <img src={src} alt={alt} width={media.width} height={media.height} />
    );
  }
  return (
    <span
      className={`lx-photos__placeholder${state === 'error' ? ' is-error' : ''}`}
      role={alt && !small ? 'img' : undefined}
      aria-label={alt && !small ? alt : undefined}
    >
      {state === 'error' ? (
        <>
          <Icon name="cloudOff" size={small ? 16 : 22} />
          {!small && (
            <span>
              No se ha podido cargar la foto. Se volverá a intentar al abrirla
              de nuevo.
            </span>
          )}
        </>
      ) : (
        <span className="lx-spinner lx-spinner--inline" aria-hidden="true" />
      )}
    </span>
  );
};
