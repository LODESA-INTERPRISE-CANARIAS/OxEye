/**
 * Index of the mock-ups: each flow as a numbered walk, in the order a
 * reviewer would try it, plus the open questions they raise.
 */
import React from 'react';
import {Chip, ContourTexture, Icon, type IconName} from '../ui';

export interface IndexEntry {
  id: string;
  title: string;
  text: string;
  who: string;
  icon: IconName;
  go: () => void;
}

const Walk: React.FC<{
  id: string;
  code: string;
  title: string;
  lead: string;
  entries: IndexEntry[];
}> = ({id, code, title, lead, entries}) => (
  <section className="lx-mk-walk" aria-labelledby={`${id}-title`}>
    <header className="lx-mk-walk__head">
      <span className="lx-mk-walk__code">{code}</span>
      <div>
        <h2 className="lx-mk-walk__title" id={`${id}-title`}>
          {title}
        </h2>
        <p className="lx-mk-walk__lead">{lead}</p>
      </div>
    </header>
    <ol className="lx-mk-walk__list">
      {entries.map((e, i) => (
        <li key={e.id}>
          <button
            type="button"
            className="lx-mk-entry"
            id={`mk-go-${e.id}`}
            onClick={e.go}
          >
            <span className="lx-mk-entry__n lx-num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="lx-mk-entry__icon" aria-hidden="true">
              <Icon name={e.icon} size={22} />
            </span>
            <span className="lx-mk-entry__text">
              <strong>{e.title}</strong>
              <span>{e.text}</span>
            </span>
            <span className="lx-mk-entry__who">
              <Chip size="sm" tag tone="neutral">
                {e.who}
              </Chip>
            </span>
            <Icon name="chevronRight" size={18} className="lx-offerrow__chev" />
          </button>
        </li>
      ))}
    </ol>
  </section>
);

/** Open questions with the answer adopted for now, to confirm with Yeray. */
export const QUESTIONS: {q: string; a: string}[] = [
  {
    q: 'Formulario del proveedor: ¿quién redacta el texto de privacidad?',
    a: 'Lo redactamos nosotros y lo revisan los servicios jurídicos del Ayuntamiento antes de usarlo de verdad.',
  },
  {
    q: 'Temporadas: ¿meses fijos para todos o los elige cada empresa?',
    a: 'Cada empresa elige sus meses; «verano» (jun–sep) y «lluvias» (nov–mar) vienen propuestos.',
  },
  {
    q: 'Comparar: ¿salen las propuestas aún sin aprobar?',
    a: 'Sí, marcadas «Propuesta pendiente de aprobar», pero sin medalla ni puesto hasta que se aprueben.',
  },
  {
    q: 'Renovaciones: ¿a quién se asigna la tarea?',
    a: 'A quien aprobó la oferta; un administrador puede cambiarlo.',
  },
  {
    q: 'Medallas: ¿colores de metal fijos o los de cada paleta?',
    a: 'Oro, plata y bronce fijos en todas las paletas, como en el Catálogo.',
  },
  {
    q: 'Sesión de soporte: ¿cuánto dura y quién la termina?',
    a: '15 minutos por defecto y 30 como máximo; la persona afectada también puede terminarla.',
  },
  {
    q: 'Cuenta «Equipo»: ¿quién cambia su foto y su nombre?',
    a: 'Solo los administradores.',
  },
  {
    q: 'Contraseña provisional: ¿cada cuánto se recuerda?',
    a: 'En cada inicio de sesión; solo bloquea la información sensible (presupuestos, contactos y precios).',
  },
  {
    q: 'Extras con precio (p. ej. transporte 90 €): ¿se suman al total?',
    a: 'Sí, siempre, con el desglose a la vista.',
  },
  {
    q: 'Fechas de servicio: ¿meses en la oferta o solo si cubre el evento?',
    a: 'La ficha de la oferta muestra los meses; la comparación solo dice si cubre las fechas del evento.',
  },
];

export const MockIndex: React.FC<{
  f1: IndexEntry[];
  f2: IndexEntry[];
}> = ({f1, f2}) => (
  <div className="lx-mk-index" id="mk-index">
    <ContourTexture />
    <header className="lx-mk-index__head">
      <p className="lx-eyebrow">Revisión 1 · maquetas navegables</p>
      <h1 className="lx-mk-index__title">
        Dos funciones nuevas, para probarlas antes de programarlas
      </h1>
      <p className="lx-mk-index__lead">
        Recorre cada flujo como lo haría un proveedor, un administrador o
        cualquier persona del equipo. Todo es ficticio: nada se guarda, nada se
        envía y nada sale de este navegador.
      </p>
    </header>
    <div className="lx-mk-index__walks">
      <Walk
        id="mk-f1"
        code="F1"
        title="Ofertas y proveedores"
        lead="Pedir presupuestos con un enlace personal, recibir propuestas, compararlas por coste total y renovarlas antes de que caduquen."
        entries={f1}
      />
      <Walk
        id="mk-f2"
        code="F2"
        title="Acceso, perfil y usuarios"
        lead="Entrar con usuario y contraseña, un espacio propio, contraseñas que nadie más conoce y herramientas de administración sin contraseña maestra."
        entries={f2}
      />
    </div>
    <section
      className="lx-card lx-mk-questions"
      aria-labelledby="mk-questions-title"
    >
      <h2 className="lx-card__title" id="mk-questions-title">
        <Icon name="question" size={20} /> Preguntas para Yeray
      </h2>
      <p className="lx-mk-questions__lead">
        Hemos seguido con estas respuestas provisionales; Yeray las confirma o
        las cambia al revisar las maquetas.
      </p>
      <ol>
        {QUESTIONS.map(({q, a}) => (
          <li key={q}>
            <span className="lx-mk-questions__q">{q}</span>
            <span className="lx-mk-questions__a">
              <Icon name="check" size={14} /> {a}{' '}
              <em>A confirmar con Yeray.</em>
            </span>
          </li>
        ))}
      </ol>
    </section>
  </div>
);
