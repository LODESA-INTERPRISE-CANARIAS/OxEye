import React, {useEffect, useRef, useState} from 'react';
import {baseCompanies} from '../../engine/logistics/companies';
import {phases} from '../../engine/logistics/phases';
import {useProjectStore} from '../../store/useProjectStore';
import type {CompanyResource} from '../../types';

export interface OrganizationsDialogProps {
  onSceneChanged: () => void;
}

/**
 * Modal dialog (`#org`) for managing subcontractor companies (`pre` / `post` shifts)
 * and capacity/security staffing.
 */
export const OrganizationsDialog: React.FC<OrganizationsDialogProps> = ({
  onSceneChanged,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);

  const isOpen = activeModal === 'org';
  const [draft, setDraft] = useState<CompanyResource[]>(baseCompanies());
  const [countStaff, setCountStaff] = useState(0);
  const [privateStaff, setPrivateStaff] = useState(0);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      const s = currentScene();
      setDraft(structuredClone(s.companies ?? baseCompanies()));
      setCountStaff(Number(s.countStaff || 0));
      setPrivateStaff(Number(s.privateStaff || 0));
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, currentScene]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateScene((s) => {
      s.companies = structuredClone(draft);
      s.countStaff = countStaff;
      s.privateStaff = privateStaff;
    }, true);
    setActiveModal(null);
    onSceneChanged();
  };

  return (
    <dialog
      id="org"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <h2>Empresas y recursos</h2>
      <div id="org-body">
        <p>
          Indica quién se ocupa de cada trabajo. Las cantidades iniciales son
          hipótesis editables. El pliego de Adeje pide medios y operarios por
          adjudicatario, sin fijar estas cantidades.
        </p>
        <form id="org-form" onSubmit={handleSave}>
          {draft.map((c, i) => (
            <fieldset key={i}>
              <legend>Empresa {i + 1}</legend>
              <label>
                Empresa{' '}
                <input
                  required
                  data-i={i}
                  data-key="name"
                  value={c.name}
                  onChange={(e) => {
                    const next = structuredClone(draft);
                    next[i].name = e.target.value;
                    setDraft(next);
                  }}
                />
              </label>
              <label>
                Responsable{' '}
                <input
                  data-i={i}
                  data-key="lead"
                  value={c.lead}
                  onChange={(e) => {
                    const next = structuredClone(draft);
                    next[i].lead = e.target.value;
                    setDraft(next);
                  }}
                />
              </label>
              <label>
                Trabajo{' '}
                <select
                  data-i={i}
                  data-key="scope"
                  value={c.scope}
                  onChange={(e) => {
                    const next = structuredClone(draft);
                    next[i].scope = e.target.value as CompanyResource['scope'];
                    setDraft(next);
                  }}
                >
                  <option value="cover">Carpas</option>
                  <option value="other">Puestos y actividades</option>
                  <option value="all">Cualquier lote</option>
                </select>
              </label>
              {(['pre', 'post'] as const).map((ph) => (
                <React.Fragment key={ph}>
                  <p>{phases[ph]}</p>
                  {(
                    [
                      ['people', 'Montadores'],
                      ['trucks', 'Camiones'],
                      ['forks', 'Carretillas'],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={`${ph}.${k}`}>
                      {label}{' '}
                      <input
                        required
                        type="number"
                        min="0"
                        max="50"
                        data-i={i}
                        data-key={`${ph}.${k}`}
                        value={Number(c[ph][k])}
                        onChange={(e) => {
                          const next = structuredClone(draft);
                          next[i][ph][k] = Number(e.target.value);
                          setDraft(next);
                        }}
                      />
                    </label>
                  ))}
                </React.Fragment>
              ))}
              <button
                type="button"
                data-remove={i}
                onClick={() => {
                  const next = structuredClone(draft);
                  next.splice(i, 1);
                  setDraft(next);
                }}
              >
                Quitar empresa
              </button>
            </fieldset>
          ))}
          <label>
            Control de aforo (personas){' '}
            <input
              type="number"
              min="0"
              max="100"
              id="count-staff"
              value={countStaff}
              onChange={(e) => setCountStaff(Number(e.target.value))}
            />
          </label>
          <label>
            Seguridad privada (personas){' '}
            <input
              type="number"
              min="0"
              max="100"
              id="private-staff"
              value={privateStaff}
              onChange={(e) => setPrivateStaff(Number(e.target.value))}
            />
          </label>
          <p>Estas dos dotaciones se registran para la organización del evento.</p>
          <button
            type="button"
            id="another"
            onClick={() =>
              setDraft((prev) => [
                ...prev,
                {
                  ...structuredClone(baseCompanies()[1]),
                  name: 'Nueva empresa',
                  scope: 'all',
                },
              ])
            }
          >
            Añadir empresa
          </button>{' '}
          <button type="submit">Guardar</button>{' '}
          <button
            type="button"
            id="org-close"
            onClick={() => setActiveModal(null)}
          >
            Cerrar
          </button>
        </form>
      </div>
    </dialog>
  );
};
