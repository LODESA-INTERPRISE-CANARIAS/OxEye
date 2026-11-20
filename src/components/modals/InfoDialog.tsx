import React, {useEffect, useRef} from 'react';
import {MAPS_DATA} from '../../data/geodata';
import {downloadFile} from '../../db/repository';
import {useProjectStore} from '../../store/useProjectStore';

/**
 * Modal dialog (`#info`) displaying application purpose, cartography sources, regulatory framework, and technical limitations.
 */
export const InfoDialog: React.FC = () => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);

  const isOpen = activeModal === 'info';

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
      id="info"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <button
        type="button"
        className="dialog-x"
        id="close-info"
        aria-label="Cerrar"
        onClick={() => setActiveModal(null)}
      >
        ×
      </button>
      <span className="eyebrow">OJO DE BUEY / NOTAS DE TRABAJO</span>
      <h2>
        Un plano para conversar.
        <br />
        Un modelo para ensayar.
      </h2>
      <p>
        La cuadrícula es una referencia visual independiente: ocultarla o
        cambiarla no mueve estructuras, accesos ni personas. Las medidas y
        tamaños se calculan en metros en UTM 28N.
      </p>
      <h3>Qué precisión tiene</h3>
      <p>
        La ortofotografía PNOA está georreferenciada. La resolución de descarga
        (20–25 cm/píxel) no equivale a precisión topográfica. Fecha del vuelo
        pendiente de confirmación. Edificios, calles y parques proceden de
        OpenStreetMap; pueden faltar árboles, mobiliario, accesos y cambios
        recientes. El ancho dibujado de los viales es simbólico; debe
        comprobarse sobre ortofoto o plano medido.
      </p>
      <p>
        El perímetro discontinuo y la distribución del evento son propuestas
        editables. No representan autorizaciones, aforos ni un montaje
        municipal. Para replantear estructuras necesitaremos un levantamiento o
        plano municipal validado.
      </p>
      <h3>Qué simula esta versión</h3>
      <p>
        Reutiliza el motor del proyecto original: personas individuales,
        obstáculos, colas, atención y clima. La malla interna de navegación de
        0,75 m es independiente de la cuadrícula visible. Los recorridos azules
        y los trazados viales son referencias de planificación; no obligan a los
        peatones a seguirlos y no se simulan vehículos.
      </p>
      <h3>Perímetros, desalojo y marco normativo</h3>
      <p>
        El círculo de precaución es una hipótesis de distancia configurable.
        Debe contrastarse con el plan autorizado, el riesgo y las instrucciones
        de coordinación. La aplicación no certifica el cumplimiento legal del
        perímetro. Las solicitudes de refuerzo son simuladas. La reserva solo
        llega si está configurada.
      </p>
      <p>
        Referencia estatal consultada el 15/11/2026: Orden INT/1068/2026,
        Directriz Básica de autoprotección, capítulo 6. En Canarias, Decreto
        86/2013, artículo 10, sobre el plan de seguridad de espectáculos. El
        plan del evento concreta detección, alarma, protección, evacuación y
        coordinación.
      </p>
      <p>
        <a
          target="_blank"
          rel="noopener noreferrer"
          href="https://www.boe.es/buscar/act.php?id=BOE-A-2026-21144"
        >
          Autoprotección: texto estatal vigente consultado
        </a>{' '}
        ·{' '}
        <a
          target="_blank"
          rel="noopener noreferrer"
          href="https://www3.gobiernodecanarias.org/libroazul/pdf/4613.pdf"
        >
          Reglamento de espectáculos de Canarias
        </a>
      </p>
      <h3>Protocolos pendientes de validar</h3>
      <p>
        Las intervenciones son hipótesis de ensayo, no una reproducción
        certificada de protocolos actuales. El anexo municipal publicado está
        fechado en 2011 y el plan del Cristo consultado corresponde a 2021. La
        elección entre primera atención, camilla y ambulancia la hace quien
        configura el ensayo; no es una decisión clínica del programa.
      </p>
      <p>
        Se comprueba una huella rectangular simplificada frente a obstáculos y
        personas. El vehículo se detiene si no encuentra paso. Las maniobras de
        giro y asistenciales usan aproximaciones. La propagación, daño y
        destrucción de estructuras son un escenario geométrico con parámetros
        editables, sin cálculo térmico o material validado. Los extintores
        necesitan personal formado, unidades disponibles y ruta. El recorrido
        termina en el punto de entrega del recinto, sin itinerario hospitalario.
      </p>
      <p>
        <a
          href="https://www.aytolalaguna.es/CDN/files/.galleries/DOCUMENTOS-Seguridad-ciudadana/Plan-de-emergencia/PEMU_A07_Protocolos_de_actuacion.pdf"
          target="_blank"
          rel="noopener noreferrer"
        >
          PEMU · anexo público de 2011
        </a>{' '}
        ·{' '}
        <a
          href="https://www.succanarias.com/suc/urgencias-sanitarias/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Coordinación sanitaria SUC
        </a>
      </p>
      <h3>Guardar y compartir</h3>
      <p>
        Se guarda en este navegador. «Exportar proyecto» descarga los tres
        espacios, sus notas y geometrías; «Abrir» permite recuperarlos. No hay
        colaboración simultánea ni sincronización entre dispositivos. El
        programa de Windows se desarrollará después.
      </p>
      <div className="source-links">
        <a
          href="#sources-download"
          onClick={(e) => {
            e.preventDefault();
            downloadFile(
              'Ojo_de_Buey_Fuentes.json',
              JSON.stringify(MAPS_DATA, null, 2)
            );
          }}
        >
          Extensiones y fuentes PNOA ↗
        </a>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
        >
          Cartografía OpenStreetMap ↗
        </a>
        <span>
          Edición portátil: cartografía y motor incorporados en este archivo.
        </span>
      </div>
    </dialog>
  );
};
