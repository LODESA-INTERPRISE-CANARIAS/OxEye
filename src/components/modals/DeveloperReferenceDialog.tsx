import React, {useEffect, useRef} from 'react';
import {useProjectStore} from '../../store/useProjectStore';

/**
 * Modal dialog (`#developer-reference`) providing functional verification notes for developers.
 */
export const DeveloperReferenceDialog: React.FC = () => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);

  const isOpen = activeModal === 'developer-reference';

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen]);

  return (
    <dialog
      id="developer-reference"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <form method="dialog">
        <button type="submit" style={{float: 'right'}}>
          Cerrar
        </button>
      </form>
      <h2>Referencia funcional para programadores</h2>
      <p>
        Este archivo parte de la v0.20 y añade mejoras de edición. Es una base
        funcional de comparación; no es la v0.30 final ni una validación de
        seguridad para un evento real.
      </p>
      <h3>Recorrido de comprobación</h3>
      <ol>
        <li>
          Continúa o crea un proyecto. En Diseñar, selecciona una estructura:
          cambia sus propiedades, arrastra los tiradores para modificar tamaño y
          usa el tirador circular para girar. Mayús conserva proporciones o
          ajusta el giro.
        </li>
        <li>
          Elige Acceso en el catálogo y marca dos extremos. Comprueba su anchura
          y uso en el inspector. Las ubicaciones de referencia del Cristo
          requieren confirmación sobre plano real.
        </li>
        <li>
          Configura el inventario y las fases de montaje, evento y desmontaje.
          Revisa el programa por días y la ficha de producción.
        </li>
        <li>
          Usa «Cargar ejemplo operativo» para sustituir expresamente el montaje
          por un ejemplo dotado y comprobado. Los proyectos anteriores guardados
          no se sobrescriben.
        </li>
        <li>
          Comprueba incidentes, dotaciones, saturación, parada del ensayo y
          resultados. Una regla interna del prototipo no equivale a un mínimo
          legal.
        </li>
        <li>
          Exporta el proyecto JSON, vuelve a importarlo y comprueba geometría,
          propiedades y configuración.
        </li>
      </ol>
      <h3>Novedades de esta entrega</h3>
      <p>
        Objetivo SMART antes de elegir lugar. Vallas seleccionables,
        desplazables y eliminables. Perímetro: Mayús en el primer clic añade un
        polígono; Ctrl en el primer clic resta una zona. Sin modificador
        sustituye el perímetro y limpia las operaciones anteriores. Confirma
        cada trazo con Terminar o Enter. Las ampliaciones y exclusiones afectan
        al motor; no son solo decoración. Símbolos cenitales diferenciados para
        las instalaciones.
      </p>
      <h3>Contrato de migración</h3>
      <p>
        Para cada función: conservar comportamiento observable, registrar el
        módulo original y el nuevo, añadir una prueba y documentar diferencias.
        No marcar una función como recuperada solo porque exista su botón.
      </p>
      <h3>Funciones que deben conservarse</h3>
      <p>
        Editor y transformaciones; accesos de dos puntos; cartografía;
        inventario; demanda; perfiles y movilidad; mesas y refugio; fases y
        logística; respuesta a incidencias; evacuación e incendio exploratorios;
        revisión previa y cancelación; programa; evaluación y memoria de
        revisión.
      </p>
      <h3>Pendientes de la siguiente versión</h3>
      <p>
        Mapa geográfico continuo, conexión topológica de caminos, uso de toda la
        anchura de los accesos por el motor, balance de llegadas y axonometría.
        No se presentan como terminados en esta referencia.
      </p>
      <p>
        <b>Entrega:</b> Aplicación modular con código, cartografía e imágenes
        incorporados.
      </p>
    </dialog>
  );
};
