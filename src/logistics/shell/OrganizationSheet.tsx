/**
 * «Organización» (Revisión 1 · E2): the organization's name and its acronym,
 * which starts the name of every PDF saved from the Gestor
 * («SCLL_Cierre-de-jornada_2026-12-02_18-30»). A member edits the acronym;
 * it starts from the proposal (`proposeAcronym`) and is checked as the
 * server checks it (`acronymProblem`). A change saved by someone else in
 * between is never overwritten: the form shows theirs. Guests only read.
 */
import React, {useEffect, useId, useState} from 'react';
import {
  ACRONYM_MAX,
  acronymFor,
  acronymProblem,
  proposeAcronym,
} from '../../../shared/logistics/acronym.ts';
import {printFileName} from '../../../shared/logistics/print-name.ts';
import {useAccess} from '../account/useAccess';
import {errorMessage, isApiError} from '../api/client';
import {DiscardStrip} from '../forms/FormParts';
import {zoneNote} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Field, HelpTip, Icon, Input, Sheet, describedBy} from '../ui';

const ACRONYM_HELP =
  'Las siglas encabezan el nombre de los PDF que se guardan desde el Gestor (fichas de trabajo, cierres de jornada), para encontrarlos y ordenarlos en una carpeta. Solo letras, números y puntos. Si se dejan vacías, se usa la propuesta a partir del nombre.';

export const OrganizationSheet: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({open, onClose}) => {
  const org = useLogisticsStore(s =>
    s.organizations.find(o => o.id === s.orgId),
  );
  // Same permission the server asks for (`plan.edit`); a provisional
  // password holds it back and the sheet says why.
  const access = useAccess();
  const canWrite = access.can('plan.edit');
  const held = access.denial('plan.edit');
  const updateOrganization = useLogisticsStore(s => s.updateOrganization);
  const toast = useLogisticsStore(s => s.toast);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const titleId = useId();

  // A fresh sheet every time it opens.
  useEffect(() => {
    if (!open) {
      setDraft(null);
      setError(null);
      setNotice(null);
      setAsking(false);
    }
  }, [open]);

  if (!org) return null;
  const proposal = proposeAcronym(org.name);
  const stored = org.acronym?.trim() || null;
  const startValue = stored ?? proposal ?? '';
  const dirty = draft !== null && draft.trim() !== startValue;
  // What a saved file would be called with the acronym on screen.
  const example = printFileName({
    organization: {
      name: org.name,
      acronym: draft !== null ? draft.trim() || null : stored,
    },
    document: 'dayClose',
    at: Date.now(),
    timeZone: org.timezone,
  });

  const close = () => {
    if (busy) return;
    if (dirty) {
      setAsking(true);
      return;
    }
    onClose();
  };

  const save = async () => {
    if (draft === null || busy) return;
    const value = draft.trim();
    const problem = acronymProblem(value);
    setError(problem);
    if (problem) {
      document.getElementById('lx-org-acronym')?.focus();
      return;
    }
    // Empty, or exactly the proposal: nothing stored, the proposal is used.
    const acronym = !value || value === proposal ? null : value;
    if (acronym === stored) {
      setDraft(null);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await updateOrganization({acronym, version: org.version});
      toast(
        acronym
          ? `Siglas guardadas: ${acronym}.`
          : 'Se usarán las siglas propuestas.',
        'success',
      );
      setDraft(null);
    } catch (err) {
      if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        const current = useLogisticsStore
          .getState()
          .organizations.find(o => o.id === org.id);
        setDraft(current ? acronymFor(current) : null);
        setNotice(
          'Otra persona ha cambiado las siglas mientras las editabas: se muestran las suyas. Revisa y vuelve a guardar si hace falta.',
        );
      } else if (isApiError(err) && err.fields?.acronym) {
        setError(err.fields.acronym);
      } else {
        setNotice(`No se han guardado las siglas. ${errorMessage(err)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const editing = draft !== null;

  return (
    <Sheet
      open={open}
      onClose={close}
      title={org.name}
      eyebrow="Organización"
      size="sm"
      id="lx-org-sheet"
      footer={
        asking ? (
          <DiscardStrip
            idPrefix="lx-org-discard"
            onKeep={() => setAsking(false)}
            onDiscard={() => {
              setAsking(false);
              setDraft(null);
              onClose();
            }}
          />
        ) : editing ? (
          <>
            <span className="lx-sheet__foot-spacer" />
            <Button
              variant="ghost"
              id="lx-org-cancel"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError(null);
                setNotice(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              icon="check"
              id="lx-org-save"
              busy={busy}
              onClick={() => void save()}
            >
              {busy ? 'Guardando…' : 'Guardar'}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="lx-orgsheet">
        {notice && (
          <p
            className="lx-notice lx-notice--error"
            role="alert"
            id="lx-org-notice"
          >
            <Icon name="alert" size={16} />
            {notice}
          </p>
        )}
        <section className="lx-subsection" aria-labelledby={titleId}>
          <h3 className="lx-subsection__title" id={titleId}>
            Siglas
            <HelpTip label="siglas de la organización">{ACRONYM_HELP}</HelpTip>
            {canWrite && !editing && (
              <Button
                size="sm"
                variant="ghost"
                icon="edit"
                className="lx-orgsheet__edit"
                id="lx-org-edit"
                onClick={() => setDraft(startValue)}
              >
                Editar
              </Button>
            )}
          </h3>
          {editing ? (
            <form
              noValidate
              onSubmit={e => {
                e.preventDefault();
                void save();
              }}
            >
              <Field
                id="lx-org-acronym"
                label="Siglas en los PDF"
                error={error ?? undefined}
                hint={`Hasta ${ACRONYM_MAX} letras, números o puntos.${proposal ? ` Propuesta: ${proposal}.` : ''} Vacío = la propuesta.`}
              >
                <Input
                  id="lx-org-acronym"
                  value={draft}
                  autoFocus
                  maxLength={ACRONYM_MAX + 4}
                  autoComplete="off"
                  spellCheck={false}
                  invalid={!!error}
                  aria-describedby={describedBy('lx-org-acronym', {
                    hint: !error,
                    error: error ?? undefined,
                  })}
                  onChange={e => {
                    setDraft(e.target.value);
                    if (error) setError(null);
                  }}
                />
              </Field>
            </form>
          ) : (
            <p className="lx-orgsheet__acronym" id="lx-org-acronym-view">
              <strong className="lx-num">{acronymFor(org) || '—'}</strong>
              {!stored && (
                <span className="lx-muted">
                  {' '}
                  · propuesta a partir del nombre
                </span>
              )}
            </p>
          )}
          <p className="lx-orgsheet__example" id="lx-org-example">
            <Icon name="print" size={16} />
            <span>
              Así se llamará un cierre de jornada guardado ahora:{' '}
              <code className="lx-num">{example}.pdf</code>
            </span>
          </p>
          {!canWrite && (
            <p className="lx-muted" id="lx-org-readonly">
              {held?.kind === 'held'
                ? held.message
                : 'Solo el equipo puede cambiar las siglas.'}
            </p>
          )}
        </section>
        <dl className="lx-detail lx-orgsheet__facts">
          <div>
            <dt>Nombre</dt>
            <dd id="lx-org-name">{org.name}</dd>
          </div>
          <div>
            <dt>Hora de referencia</dt>
            <dd className="lx-num">{zoneNote(org.timezone)}</dd>
          </div>
        </dl>
      </div>
    </Sheet>
  );
};
