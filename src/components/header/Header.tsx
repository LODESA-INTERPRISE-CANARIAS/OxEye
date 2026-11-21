import React, {useRef} from 'react';
import {MAPS_DATA} from '../../data/geodata';
import {downloadFile, parseImportedProject} from '../../db/repository';
import {useProjectStore} from '../../store/useProjectStore';

export interface HeaderProps {
  onProjectImported: () => void;
  onPauseSimulation: () => void;
  onSceneChanged?: () => void;
}

/**
 * Top application header containing branding, project modals, file import/export, and help.
 */
export const Header: React.FC<HeaderProps> = ({
  onProjectImported,
  onPauseSimulation,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const project = useProjectStore((s) => s.project);
  const panel = useProjectStore((s) => s.panel);
  const saveStatusText = useProjectStore((s) => s.saveStatusText);
  const setMenuOpen = useProjectStore((s) => s.setMenuOpen);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const save = useProjectStore((s) => s.save);
  const showToast = useProjectStore((s) => s.showToast);
  const replaceProject = useProjectStore((s) => s.replaceProject);

  const isSimulate = panel === 'simulate';

  const handleExport = () => {
    save();
    downloadFile('Ojo_de_Buey_Proyecto.json', JSON.stringify(project, null, 2));
    showToast('Proyecto exportado con los tres espacios y sus observaciones.');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      if (f.size > 5e6) {
        throw new Error('El archivo supera los 5 MB.');
      }
      const text = await f.text();
      const next = parseImportedProject(text, project, MAPS_DATA);
      replaceProject(next, true);
      setMenuOpen(false);
      onProjectImported();
      showToast('Proyecto abierto. Puedes deshacer la importación.');
    } catch {
      showToast('El archivo importado no es un modelo válido', 'error');
    }
    e.target.value = '';
  };

  return (
    <header className="header">
      <a
        className="brand"
        href="./"
        aria-label="Ojo de Buey, inicio"
        onClick={(e) => {
          e.preventDefault();
          onPauseSimulation();
          setMenuOpen(true);
        }}
      >
        <img src="./favicon.svg" alt="" />
        <span>
          OJO DE BUEY<small>ESPACIO PARA ANTICIPARSE</small>
        </span>
      </a>
      <div className="project-heading">
        <span className="eyebrow">SAN CRISTÓBAL DE LA LAGUNA</span>
        <b>Laboratorio de eventos</b>
        <span className="badge">REFERENCIA · EDICIÓN 21</span>
      </div>
      <div className="header-actions">
        <button
          id="main-menu"
          className="header-primary-btn header-menu-btn"
          type="button"
          onClick={() => {
            onPauseSimulation();
            setMenuOpen(true);
          }}
        >
          <span aria-hidden="true">☰</span>
          <span>Menú</span>
        </button>
        <button
          id="demand"
          className="header-primary-btn header-demand-btn"
          type="button"
          onClick={() => setActiveModal('demand')}
        >
          <span aria-hidden="true">⊞</span>
          <span>Calcular servicios</span>
        </button>
        <button
          id="inventory"
          className="quiet"
          type="button"
          disabled={isSimulate}
          onClick={() => setActiveModal('inventory')}
        >
          1. Inventario
        </button>
        <button
          id="risk-button"
          className="quiet"
          type="button"
          onClick={() => {
            onPauseSimulation();
            setActiveModal('risk');
          }}
        >
          Revisar riesgos
        </button>
        <button
          id="programme"
          className="quiet"
          type="button"
          onClick={() => setActiveModal('programme')}
        >
          Programa por días
        </button>
        <button
          id="laboratory"
          className="quiet"
          type="button"
          disabled={isSimulate}
          onClick={() => setActiveModal('laboratory')}
        >
          Comparar diseños
        </button>
        <button
          id="contacts"
          className="quiet"
          type="button"
          onClick={() => setActiveModal('contacts')}
        >
          Contactos
        </button>
        <button
          id="organizations"
          className="quiet"
          type="button"
          disabled={isSimulate}
          onClick={() => setActiveModal('org')}
        >
          Empresas y recursos
        </button>
        <button
          id="settings"
          className="quiet"
          type="button"
          disabled={isSimulate}
          onClick={() => setActiveModal('parameters')}
        >
          Ficha de producción
        </button>
        <button
          id="developer-reference-button"
          className="quiet"
          type="button"
          onClick={() => setActiveModal('developer-reference')}
        >
          Guía para programadores
        </button>
        <span
          id="save-status"
          className={`save-status${saveStatusText.includes('Sin guardar') ? ' is-unsaved' : ''}`}
          aria-live="polite"
          tabIndex={0}
          aria-label={
            saveStatusText.includes('Sin guardar')
              ? saveStatusText
              : 'Guardado en este ordenador'
          }
          data-tooltip={
            saveStatusText.includes('Sin guardar')
              ? saveStatusText
              : 'Guardado en este ordenador'
          }
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </span>
        <button
          id="import"
          className="quiet header-icon-btn"
          type="button"
          disabled={isSimulate}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>Importar</span>
        </button>
        <button
          id="export"
          className="dark header-icon-btn"
          type="button"
          onClick={handleExport}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>Exportar</span>
        </button>
        <button
          id="help"
          className="help"
          type="button"
          aria-label="Ayuda y fuentes"
          onClick={() => setActiveModal('info')}
        >
          ?
        </button>
        <input
          id="file"
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={handleFileChange}
        />
      </div>
    </header>
  );
};
