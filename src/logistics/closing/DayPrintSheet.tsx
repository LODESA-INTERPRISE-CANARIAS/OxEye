/**
 * «Vista para imprimir»: the day close as an A4 page, with a banner that
 * says which note texts it carries, and «Guardar como PDF» (the browser's
 * print dialog). The printed copy is the one the screen keeps portalled to
 * <body> (`.lx-day-root`); nothing is sent anywhere.
 */
import React from 'react';
import type {DayReport} from '../../../shared/logistics/day-report.ts';
import {printWithName} from '../shell/usePrintTitle';
import {Button, Icon, Sheet} from '../ui';
import {includedTextTitles, listJoin} from './day';
import {DayReportPage, type DayReportPageProps} from './DayReportPage';

export const DayPrintSheet: React.FC<{
  page: Omit<DayReportPageProps, 'id'>;
  onClose: () => void;
  onCopy: () => void;
}> = ({page, onClose, onCopy}) => {
  const report: DayReport = page.report;
  const titles = includedTextTitles(report);
  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-day-print-sheet"
      className="lx-sheet--dayprint"
      eyebrow="Cierre de jornada"
      title="Vista para imprimir"
      meta={
        <span className="lx-sheet__sub">
          Así queda la página. Para el PDF, elige «Guardar como PDF» como
          destino en el diálogo de impresión.
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} id="lx-day-print-close">
            Cerrar
          </Button>
          <span className="lx-sheet__foot-spacer" />
          <Button icon="copy" id="lx-day-print-copy" onClick={onCopy}>
            Copiar resumen
          </Button>
          <Button
            variant="primary"
            icon="print"
            id="lx-day-print-go"
            onClick={printWithName}
          >
            Guardar como PDF
          </Button>
        </>
      }
    >
      <div className="lx-dayprint">
        <div
          className={`lx-notice${titles.length ? ' lx-notice--error' : ''}`}
          id="lx-day-print-banner"
          role="note"
        >
          <Icon name={titles.length ? 'alert' : 'lock'} size={18} />
          <div>
            {!report.notes ? (
              <p>
                Sin notas ni hipótesis: las ve el equipo con su propio usuario.
              </p>
            ) : titles.length ? (
              <>
                <p>
                  <strong>Incluye el texto de: {listJoin(titles)}.</strong>
                </p>
                <p>
                  Léelo antes de compartir el PDF: lo podrá leer cualquiera que
                  lo reciba.
                </p>
              </>
            ) : (
              <p>
                Sin el texto de ninguna nota: solo su tipo, de qué tratan y su
                estado. Para incluirlo, cierra esta vista y marca «Incluir el
                texto» en cada sección.
              </p>
            )}
          </div>
        </div>
        <div className="lx-dayprint__paper">
          <DayReportPage {...page} id="lx-day-preview" />
        </div>
      </div>
    </Sheet>
  );
};
