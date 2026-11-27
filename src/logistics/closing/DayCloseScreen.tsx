/**
 * «Cierre de jornada»: what one day held, read like a field report. The
 * day's changes and who made them, how much is still unverified and what
 * we still need, the team's notes and hypotheses (members only), the safety
 * reminders, what was left unfinished and what comes next. «Vista para
 * imprimir» shows the A4 page and saves it with the browser's «Guardar como
 * PDF»; «Copiar resumen» puts a short text on the clipboard (never note
 * text). Nothing is sent anywhere.
 *
 * The report is always `buildDayReport` over the store's records (the
 * server's `forViewer` copies) plus the day's activity, or the records' own
 * dates when the activity cannot be loaded.
 *
 * Link: `#logistica/cierre` is today; `#logistica/cierre/YYYY-MM-DD` a past
 * day. The day comes from `LogisticsApp`, which keeps the link and the
 * browser history in step (each day visited is a step of «Atrás»).
 *
 * Printing (the button or Ctrl+P) names the saved PDF
 * `SIGLAS_Cierre-de-jornada_YYYY-MM-DD_HH-mm`; a past day adds «del-<día>».
 */
import React, {useCallback, useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import type {LocalDate, Task} from '../../../shared/logistics/contracts.ts';
import {
  dayReportText,
  type DayNoteKind,
  type DayTaskLine,
} from '../../../shared/logistics/day-report.ts';
import {printFileName} from '../../../shared/logistics/print-name.ts';
import {ACTIVITY_RANGE_MAX} from '../../../shared/logistics/rules.ts';
import {addDays, isLocalDate} from '../../../shared/logistics/time.ts';
import {useActions} from '../common/actions';
import {windowText} from '../common/TimeWindow';
import {copyText} from '../lib/clipboard';
import {longDate, todayIn, zoneNote} from '../lib/format';
import {recordDays} from '../lib/tasks';
import {usePrintTitle} from '../shell/usePrintTitle';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  DateField,
  EmptyState,
  Icon,
  IconButton,
  SkeletonRows,
} from '../ui';
import {clampDay, isQuietDay, stampText} from './day';
import {
  DayAccepted,
  DayHypotheses,
  DayNotes,
  GuestNotesBlock,
} from './DayNotes';
import {DayNeeds, DayNext, DaySafety, DayUnfinished} from './DayPlan';
import {DayPrintSheet} from './DayPrintSheet';
import {DayRecords} from './DayRecords';
import {DayReportPage, type DayReportPageProps} from './DayReportPage';
import {DaySummary} from './DaySummary';
import {timeIn} from './parts';
import {useDayReport} from './useDayReport';

const UNSENT_SHOWN = 4;

type Include = Partial<Record<DayNoteKind, boolean>>;
const NONE: Include = {};

export interface DayCloseScreenProps {
  /** Day from the link; null = today. Later days show today. */
  day: LocalDate | null;
  /** Another day was chosen (null = back to today). */
  onDay: (day: LocalDate | null) => void;
}

export const DayCloseScreen: React.FC<DayCloseScreenProps> = ({day, onDay}) => {
  const {today, timeZone} = useActions();
  const orgId = useLogisticsStore(s => s.orgId);
  const organization = useLogisticsStore(
    s => s.organizations.find(o => o.id === s.orgId) ?? null,
  );
  const orgName = organization?.name ?? null;
  const toast = useLogisticsStore(s => s.toast);
  const tasks = useLogisticsStore(s => s.tasks);

  const date = clampDay(day ?? today, today);
  // Note texts are chosen per day: another day starts with none included.
  const [include, setInclude] = useState<{date: LocalDate; kinds: Include}>({
    date,
    kinds: NONE,
  });
  const includeText = include.date === date ? include.kinds : NONE;
  const [preview, setPreview] = useState(false);

  const goTo = useCallback(
    (next: LocalDate) => {
      if (!isLocalDate(next)) return;
      const clamped = clampDay(next, today);
      // Today keeps the plain link (a bookmark always opens today's close).
      onDay(clamped === today ? null : clamped);
    },
    [today, onDay],
  );

  // «SCLL_Cierre-de-jornada_2026-12-02_18-30»: named at the moment of
  // printing; a past day says which one.
  usePrintTitle({
    fileName: () => {
      const at = Date.now();
      return printFileName({
        organization,
        document: 'dayClose',
        subject: date === todayIn(timeZone) ? null : `del ${date}`,
        at,
        timeZone,
      });
    },
    stamp: () => stampText(new Date().toISOString(), timeZone),
  });

  const onInclude = useCallback(
    (kind: DayNoteKind, on: boolean) =>
      setInclude(prev => ({
        date,
        kinds: {...(prev.date === date ? prev.kinds : NONE), [kind]: on},
      })),
    [date],
  );

  const {report, activity, unsent, unsentEntries, recordsLoading} =
    useDayReport(date, timeZone, today, includeText);

  const taskIndex = useMemo(
    () => new Map<string, Task>(tasks.map(t => [t.id, t])),
    [tasks],
  );
  const windowOf = useCallback(
    (line: DayTaskLine) =>
      windowText(
        taskIndex.get(line.id) ?? {
          date: line.date,
          endDate: null,
          startsAt: line.startsAt,
          endsAt: line.endsAt,
          timezone: line.timezone,
        },
      ),
    [taskIndex],
  );
  const daysOf = useCallback(
    (line: DayTaskLine) => {
      const task = taskIndex.get(line.id);
      return task ? recordDays(task) : line.date ? [line.date] : [];
    },
    [taskIndex],
  );

  const copySummary = useCallback(async () => {
    if (!report) return;
    const ok = await copyText(dayReportText(report, longDate(report.date)));
    toast(
      ok
        ? 'Resumen copiado: pégalo en WhatsApp o en un correo.'
        : 'No se ha podido copiar el resumen. Usa «Vista para imprimir».',
      ok ? 'success' : 'error',
    );
  }, [report, toast]);

  if (!orgId) {
    return (
      <div className="lx-dayclose" id="lx-space-cierre">
        <EmptyState icon="user" title="Sin organización" id="lx-day-no-org">
          No perteneces a ninguna organización todavía. Pide acceso a quien
          gestiona el Gestor logístico.
        </EmptyState>
      </div>
    );
  }

  const isToday = date === today;
  const subtitle = isToday
    ? report
      ? `Hoy · hasta las ${timeIn(report.generatedAt, timeZone)} (${zoneNote(timeZone)})`
      : `Hoy · ${zoneNote(timeZone)}`
    : date === addDays(today, -1)
      ? `Ayer · ${zoneNote(timeZone)}`
      : zoneNote(timeZone);

  const page: Omit<DayReportPageProps, 'id'> | null = report
    ? {
        report,
        orgName,
        generatedAtText: stampText(report.generatedAt, timeZone),
        windowOf,
        daysOf,
        unsent,
      }
    : null;

  const activityLoading = activity.status === 'loading';
  const quiet = !!report && !activityLoading && isQuietDay(report);

  return (
    <div className="lx-dayclose" id="lx-space-cierre">
      <header className="lx-dayhead">
        <div className="lx-dayhead__titles">
          <p className="lx-eyebrow">Informe del día</p>
          <h2
            className="lx-dayhead__title"
            id="lx-day-title"
            aria-live="polite"
          >
            {longDate(date)}
          </h2>
          <p className="lx-dayhead__sub lx-num">{subtitle}</p>
        </div>

        <div
          className="lx-dayhead__nav"
          role="group"
          aria-label="Día del cierre"
        >
          <IconButton
            icon="chevronLeft"
            label="Día anterior"
            variant="secondary"
            id="lx-day-prev"
            onClick={() => goTo(addDays(date, -1))}
          />
          <div className="lx-dayhead__date">
            <DateField
              id="lx-day-date"
              className="lx-dayhead__dateinput"
              aria-label="Elegir el día del cierre"
              value={date}
              max={today}
              today={today}
              timeZone={timeZone}
              clearable={false}
              onChange={v => goTo(v)}
            />
          </div>
          <IconButton
            icon="chevronRight"
            label="Día siguiente"
            variant="secondary"
            id="lx-day-next-day"
            disabled={date >= today}
            onClick={() => goTo(addDays(date, 1))}
          />
          {!isToday && (
            <Button
              size="sm"
              variant="ghost"
              icon="today"
              id="lx-day-today"
              onClick={() => goTo(today)}
            >
              Hoy
            </Button>
          )}
        </div>

        <div className="lx-dayhead__actions">
          <Button
            icon="copy"
            id="lx-day-copy"
            disabled={!report}
            onClick={() => void copySummary()}
          >
            Copiar resumen
          </Button>
          <Button
            variant="primary"
            icon="print"
            id="lx-day-print"
            disabled={!report}
            onClick={() => setPreview(true)}
          >
            Vista para imprimir
          </Button>
        </div>
      </header>

      {(activity.status === 'offline' || activity.status === 'failed') && (
        <div
          className="lx-notice lx-dayclose__notice"
          id="lx-day-offline"
          role="status"
        >
          <Icon name="cloudOff" size={18} />
          <p>
            {activity.status === 'offline'
              ? 'Sin conexión: las cifras salen de las fechas de los registros guardados y no incluyen lo borrado.'
              : 'No se ha podido cargar el historial del día: las cifras salen de las fechas de los registros guardados y no incluyen lo borrado.'}
          </p>
          {activity.status === 'failed' && (
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              id="lx-day-retry"
              onClick={activity.retry}
            >
              Reintentar
            </Button>
          )}
        </div>
      )}
      {activity.status === 'ready' && activity.truncated && (
        <div
          className="lx-notice lx-dayclose__notice"
          id="lx-day-truncated"
          role="status"
        >
          <Icon name="alert" size={18} />
          <p className="lx-num">
            Este día tiene más de {ACTIVITY_RANGE_MAX.toLocaleString('es-ES')}{' '}
            cambios registrados: las cifras pueden quedarse cortas.
          </p>
        </div>
      )}
      {unsentEntries.length > 0 && (
        <div
          className="lx-notice lx-dayclose__notice lx-dayclose__unsent"
          id="lx-day-unsent"
          role="status"
        >
          <Icon name="cloudOff" size={18} />
          <div>
            <p>
              <strong className="lx-num">
                {unsentEntries.length === 1
                  ? '1 cambio de este dispositivo está pendiente de enviar'
                  : `${unsentEntries.length} cambios de este dispositivo están pendientes de enviar`}
              </strong>
              : el equipo aún no los ve y el cierre del servidor no los cuenta.
            </p>
            <ul className="lx-dayclose__unsentlist">
              {unsentEntries.slice(0, UNSENT_SHOWN).map(e => (
                <li key={e.id}>{e.label}</li>
              ))}
              {unsentEntries.length > UNSENT_SHOWN && (
                <li className="lx-muted lx-num">
                  y {unsentEntries.length - UNSENT_SHOWN} más
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      {recordsLoading || !report ? (
        <div className="lx-card">
          <SkeletonRows rows={6} label="Cargando los registros del equipo" />
        </div>
      ) : (
        <div className="lx-dayclose__grid" key={date}>
          <div className="lx-dayclose__col">
            <DaySummary report={report} loading={activityLoading} />
            <DayRecords
              report={report}
              timeZone={timeZone}
              unsent={unsent}
              loading={activityLoading}
              quiet={quiet}
            />
            {report.notes ? (
              <>
                <DayNotes
                  report={report}
                  timeZone={timeZone}
                  onInclude={onInclude}
                />
                <DayHypotheses report={report} timeZone={timeZone} />
              </>
            ) : (
              <>
                <DayAccepted report={report} timeZone={timeZone} />
                <GuestNotesBlock />
              </>
            )}
          </div>
          <div className="lx-dayclose__col">
            <DayNeeds report={report} />
            <DaySafety report={report} />
            <DayUnfinished report={report} />
            <DayNext report={report} />
          </div>
        </div>
      )}

      {page && preview && (
        <DayPrintSheet
          page={page}
          onClose={() => setPreview(false)}
          onCopy={() => void copySummary()}
        />
      )}
      {/* The printed copy: present while this screen is open, so the print
          dialog (also Ctrl+P) gets the page, never the app around it. */}
      {page &&
        createPortal(
          <div className="lx-day-root" aria-hidden="true">
            <DayReportPage {...page} />
          </div>,
          document.body,
        )}
    </div>
  );
};
