/**
 * @module engine/emergency/risk-guidance
 * Catálogo exhaustivo de guía visual y acciones directas para todas las
 * incidencias posibles de `assessRisk` y `liveFailures` en el diálogo de
 * Revisión de riesgos (`#risk-dialog`).
 */
import type {ActiveModal} from '../../store/useProjectStore';
import type {Scene} from '../../types';
import type {RiskIssue} from './risk';

/** Tipos de acción interactiva para resolver un riesgo desde `#risk-dialog`. */
export type RiskActionKind =
  | 'select-item'
  | 'switch-tool'
  | 'open-modal'
  | 'focus-panel'
  | 'focus-risk-form'
  | 'quick-fix';

/** Ajustes rápidos seguros en un clic (siempre con checkpoint de deshacer). */
export type RiskQuickFixType =
  | 'sync-demand-arrivals'
  | 'cap-vehicle-to-one'
  | 'fit-overbook-capacity'
  | 'enable-trained'
  | 'add-dry-staff'
  | 'clear-heavy-load'
  | 'relocate-emergency-resource'
  | 'enable-fire-foot-access';

/** Botón de acción guiada asociado a un `RiskIssue`. */
export interface RiskGuideAction {
  label: string;
  kind: RiskActionKind;
  primary?: boolean;
  itemId?: string;
  enableXray?: boolean;
  tool?: string;
  modal?: ActiveModal;
  panel?: 'design' | 'simulate' | 'review';
  fixType?: RiskQuickFixType;
}

/** Guía explicativa y botones de solución para una incidencia de riesgo. */
export interface RiskGuide {
  icon: string;
  cause: string;
  steps: string[];
  actions: RiskGuideAction[];
}

/**
 * Resuelve la guía paso a paso y los botones interactivos adecuados para
 * cualquier `RiskIssue` generado por `assessRisk` o `liveFailures`.
 *
 * @param issue - Incidencia de riesgo (`critical` o `warning`).
 * @param scene - Escena activa (para resolver referencias a piezas concretas).
 * @returns Guía completa con icono, explicación, pasos y acciones directas.
 */
export function resolveRiskGuide(issue: RiskIssue, scene: Scene): RiskGuide {
  const id = issue.id;

  // 1. Carga pesada sobre forjado del subsuelo sin apoyo estructural
  if (id.startsWith('subsoil-load-')) {
    const itemId = id.slice('subsoil-load-'.length);
    return {
      icon: '🧱',
      cause:
        'La huella de una pieza clasificada como carga pesada apoya sobre el vano hueco del garaje/subsuelo fuera del radio de apoyo de pilares, muros interiores y muros perimetrales de carga.',
      steps: [
        'Activa la capa Rayos X para ver el forjado hueco (rayado) y las zonas verdes de apoyo estructural.',
        'Desplaza la pieza fuera del perímetro del garaje o sitúala sobre las bandas verdes de pilares, muros interiores o muros perimetrales.',
        'Si esta pieza concreta no supone carga pesada real, puedes desmarcar «Carga pesada» en su Inspector.',
      ],
      actions: [
        {
          label: 'Ver en Rayos X y seleccionar pieza',
          kind: 'select-item',
          itemId,
          enableXray: true,
          primary: true,
        },
        {
          label: 'Desmarcar carga pesada',
          kind: 'quick-fix',
          fixType: 'clear-heavy-load',
          itemId,
        },
      ],
    };
  }

  // 1b. Dotación de lastres incompleta en una carpa
  if (id.startsWith('ballast-missing-')) {
    const coverId = id.slice('ballast-missing-'.length);
    return {
      icon: '⛁',
      cause:
        'La carpa tiene configurada una dotación de lastres según ficha técnica y el número o masa de los lastres vinculados es inferior al requerido.',
      steps: [
        'Coloca elementos «Lastre / contrapeso» desde el catálogo (Logística) junto a la carpa.',
        'Ajusta su masa (kg) y superficie de apoyo según la ficha del fabricante.',
        'Selecciona los lastres y la carpa y pulsa Ctrl+G para agruparlos y moverlos juntos.',
      ],
      actions: [
        {
          label: 'Seleccionar carpa',
          kind: 'select-item',
          itemId: coverId,
          primary: true,
        },
        {
          label: 'Colocar lastre / contrapeso',
          kind: 'switch-tool',
          tool: 'place:ballast',
        },
      ],
    };
  }

  // 2. Vehículo con capacidad > 1
  if (id.startsWith('vehicle-capacity-')) {
    const itemId = id.slice('vehicle-capacity-'.length);
    return {
      icon: '🚑',
      cause:
        'Un mismo vehículo de emergencias tiene configurados varios equipos simultáneos, pero físicamente solo puede atender una intervención a la vez.',
      steps: [
        'Reduce «Equipos simultáneos» a 1 en el Inspector del vehículo.',
        'Si necesitas cubrir varias emergencias simultáneas, añade otro vehículo independiente en el plano.',
      ],
      actions: [
        {
          label: 'Ajustar capacidad a 1',
          kind: 'quick-fix',
          fixType: 'cap-vehicle-to-one',
          itemId,
          primary: true,
        },
        {label: 'Seleccionar vehículo', kind: 'select-item', itemId},
      ],
    };
  }

  // 3. Capacidad sin personal suficiente
  if (id.startsWith('overbook-')) {
    const itemId = id.slice('overbook-'.length);
    return {
      icon: '👥',
      cause:
        'El número de equipos simultáneos declarados supera el personal disponible para formar cada dotación.',
      steps: [
        'Aumenta el «Personal supuesto» del recurso o reduce los «Equipos simultáneos» en su Inspector.',
      ],
      actions: [
        {
          label: 'Ajustar equipos al personal',
          kind: 'quick-fix',
          fixType: 'fit-overbook-capacity',
          itemId,
          primary: true,
        },
        {label: 'Editar recurso en el plano', kind: 'select-item', itemId},
      ],
    };
  }

  // 4. Dotación inválida
  if (id.startsWith('invalid-')) {
    const itemId = id.slice('invalid-'.length);
    return {
      icon: '⚠️',
      cause:
        'Los campos de personal o equipos simultáneos contienen decimales o valores negativos.',
      steps: [
        'Selecciona el recurso en el plano e introduce enteros ≥ 0 en Personal y Equipos simultáneos.',
      ],
      actions: [
        {
          label: 'Seleccionar recurso',
          kind: 'select-item',
          itemId,
          primary: true,
        },
      ],
    };
  }

  // 5. Falta acceso compatible para vehículo de emergencias
  if (id.startsWith('gate-')) {
    const kind = id.slice('gate-'.length);
    const kindLabel =
      ({fire: 'bomberos', ambulance: 'ambulancia', patrol: 'policía'} as Record<
        string,
        string
      >)[kind] || kind;
    const firstGate = scene.entrances[0]?.id;
    return {
      icon: '🚧',
      cause: `Ningún acceso abierto cumple simultáneamente la anchura libre y la autorización de autoridades necesaria para ${kindLabel}.`,
      steps: [
        'Selecciona un acceso en el plano y abre «¿Están las autoridades recomendadas a usar este acceso?».',
        'Marca el tipo de unidad correspondiente (vehículos pesados para bomberos, turismos/camillas para ambulancia o policía) y verifica que la anchura libre sea suficiente.',
      ],
      actions: [
        ...(firstGate
          ? [
              {
                label: 'Editar acceso en el plano',
                kind: 'select-item' as const,
                itemId: firstGate,
                primary: true,
              },
            ]
          : []),
        {
          label: 'Dibujar nuevo acceso amplio',
          kind: 'switch-tool',
          tool: 'gateLine',
          primary: !firstGate,
        },
      ],
    };
  }

  // 6. Actividad sin conexión entre acceso y salida
  if (id.startsWith('connection-')) {
    const stationId = id.slice('connection-'.length);
    return {
      icon: '🔀',
      cause:
        'La malla transitable no consigue conectar este puesto con al menos una entrada y una salida pública (suele ocurrir por vallas cerradas, reservas o puestos demasiado pegados).',
      steps: [
        'Separa los obstáculos que rodean la pieza para abrir un pasillo continuo de al menos 2 m.',
        'Comprueba que el puesto queda dentro del perímetro del evento y que existen entradas y salidas conectadas.',
      ],
      actions: [
        {
          label: 'Seleccionar pieza aislada',
          kind: 'select-item',
          itemId: stationId,
          primary: true,
        },
        {
          label: 'Probar redistribución automática',
          kind: 'open-modal',
          modal: 'comparison',
        },
      ],
    };
  }

  // 7. Ruta bloqueada para equipos de emergencia
  if (id.startsWith('route-')) {
    const meta = issue.meta;
    const kind = meta?.kind || id.slice('route-'.length);
    const resObj =
      (meta?.resourceId &&
        scene.infrastructure.find((r) => r.id === meta.resourceId)) ||
      scene.infrastructure.find(
        (r) => r.role === 'emergency' && r.kind === kind && r.active !== false
      );
    const resId = meta?.resourceId || resObj?.id;
    const resName = meta?.resourceName || resObj?.name || 'el equipo';
    const targetId = meta?.targetId;
    const targetName = meta?.targetName;
    const widthTxt = meta?.requiredWidth ? `${meta.requiredWidth} m` : '3,5 m';
    const isStartBlocked = meta?.reason === 'start_blocked';
    const isNarrowTurn = meta?.reason === 'narrow_turn';

    const cause = isStartBlocked
      ? `«${resName}» está colocado sobre un obstáculo, valla o fuera del área libre (necesita al menos ${widthTxt} despejados en su posición inicial).`
      : isNarrowTurn
        ? `El recorrido entre «${resName}» y ${targetName ? `«${targetName}»` : 'un punto de actividad'} tiene un giro o estrechamiento menor de ${widthTxt}.`
        : `No existe un corredor libre de ${widthTxt} que conecte «${resName}» con ${targetName ? `«${targetName}»` : 'al menos un punto de actividad'}.`;

    const steps = isStartBlocked
      ? [
          `Usa «Reubicar «${resName}» en zona despejada» para situarlo automáticamente en el paso libre más cercano.`,
          `Si prefieres elegir tú el lugar, selecciona «${resName}» en el plano y arrástralo a una zona abierta dentro del perímetro.`,
        ]
      : [
          targetName
            ? `Selecciona «${targetName}» en el plano y separa los puestos, mesas picnic o vallas que cortan el paso (deja ≥ ${widthTxt} libres).`
            : `Ensancha los pasillos principales separando puestos, mesas picnic o vallas (deja ≥ ${widthTxt} libres).`,
          `También puedes seleccionar «${resName}» y acercarlo a un corredor despejado${kind === 'fire' && !scene.fireFootAccess ? ', o permitir el despliegue a pie de bomberos' : ''}.`,
        ];

    const actions: RiskGuideAction[] = [];
    if (isStartBlocked && resId) {
      actions.push({
        label: `Reubicar «${resName}» en zona despejada`,
        kind: 'quick-fix',
        fixType: 'relocate-emergency-resource',
        itemId: resId,
        primary: true,
      });
    } else if (targetId && targetName) {
      actions.push({
        label: `Ir a «${targetName}» en el plano`,
        kind: 'select-item',
        itemId: targetId,
        primary: true,
      });
    }
    if (resId) {
      actions.push({
        label: `Seleccionar «${resName}»`,
        kind: 'select-item',
        itemId: resId,
        primary: actions.length === 0,
      });
      if (!isStartBlocked) {
        actions.push({
          label: `Reubicar «${resName}» en paso libre`,
          kind: 'quick-fix',
          fixType: 'relocate-emergency-resource',
          itemId: resId,
        });
      }
    }
    if (kind === 'fire' && !scene.fireFootAccess) {
      actions.push({
        label: 'Permitir despliegue a pie de bomberos',
        kind: 'quick-fix',
        fixType: 'enable-fire-foot-access',
      });
    }
    actions.push({
      label: 'Comparar distribución alternativa',
      kind: 'open-modal',
      modal: 'comparison',
      primary: actions.length === 0,
    });

    return {
      icon: isStartBlocked ? '📍' : '🛣️',
      cause,
      steps,
      actions,
    };
  }

  // 8. Incidencia en vivo sin respuesta disponible (fallo crítico durante ensayo)
  if (id.startsWith('incident-')) {
    const isNarrow =
      issue.action.toLowerCase().includes('huella') ||
      issue.action.toLowerCase().includes('estrechamiento') ||
      issue.action.toLowerCase().includes('paso') ||
      issue.action.toLowerCase().includes('giro');
    return {
      icon: isNarrow ? '🚧' : '🚨',
      cause: isNarrow
        ? 'Durante el ensayo, el vehículo o equipo de respuesta no pudo llegar al incidente porque el ancho de su huella no cabe en un estrechamiento o giro del recorrido.'
        : 'La incidencia superó el tiempo máximo de espera sin equipo libre o sin acceso válido disponible.',
      steps: isNarrow
        ? [
            'Revisa los pasillos y giros alrededor de los puestos y vallas: separa las piezas para garantizar un corredor despejado.',
            'Comprueba también la anchura libre y orientación de los accesos de emergencia.',
            'Si los bomberos no caben en vehículo, puedes habilitar el acceso a pie en las opciones de respuesta o reubicar el camión más cerca del eje central.',
          ]
        : [
            'Añade más dotaciones activas (sanitario, seguridad, bomberos o ambulancia) en Inventario.',
            'Reduce la demora o acerca los recursos al centro del recinto para acortar el tiempo de llegada.',
          ],
      actions: isNarrow
        ? [
            {
              label: 'Ir a Diseñar y despejar pasos',
              kind: 'focus-panel',
              panel: 'design',
              primary: true,
            },
            {
              label: 'Probar redistribución automática',
              kind: 'open-modal',
              modal: 'comparison',
            },
            {
              label: 'Ajustar recursos en Inventario',
              kind: 'open-modal',
              modal: 'inventory',
            },
          ]
        : [
            {
              label: 'Añadir recursos en Inventario',
              kind: 'open-modal',
              modal: 'inventory',
              primary: true,
            },
            {
              label: 'Ir al plano a acercar equipos',
              kind: 'focus-panel',
              panel: 'design',
            },
            {
              label: 'Probar redistribución automática',
              kind: 'open-modal',
              modal: 'comparison',
            },
          ],
    };
  }

  // 9. Casos exactos por ID
  switch (id) {
    case 'inputs':
      return {
        icon: '📊',
        cause:
          'Las llegadas por hora o la duración de la jornada están fuera del intervalo permitido por el simulador (0–3.000 llegadas/h y 1–24 h).',
        steps: [
          'Abre el espacio Simular y corrige «Llegadas por hora» y «Duración de la jornada».',
        ],
        actions: [
          {
            label: 'Ajustar parámetros en Simular',
            kind: 'focus-panel',
            panel: 'simulate',
            primary: true,
          },
        ],
      };
    case 'demand-invalid':
    case 'area':
      return {
        icon: '📐',
        cause:
          id === 'area'
            ? 'La superficie ocupada por los módulos calculados supera el área útil declarada del recinto.'
            : 'Alguna variable de Dimensionar oferta contiene un valor negativo o no numérico.',
        steps: [
          'Abre «Calcular servicios» (Demanda) y revisa la superficie disponible o reduce el número de módulos.',
        ],
        actions: [
          {
            label: 'Abrir Calcular servicios',
            kind: 'open-modal',
            modal: 'demand',
            primary: true,
          },
        ],
      };
    case 'demand-sync':
      return {
        icon: '🔄',
        cause:
          'La previsión de llegadas/h configurada en Simular no coincide con la usada en «Calcular servicios».',
        steps: [
          'Iguala las llegadas/h del ensayo con las del cálculo de demanda o actualiza el cálculo de demanda.',
        ],
        actions: [
          {
            label: 'Igualar afluencia automáticamente',
            kind: 'quick-fix',
            fixType: 'sync-demand-arrivals',
            primary: true,
          },
          {label: 'Abrir Calcular servicios', kind: 'open-modal', modal: 'demand'},
        ],
      };
    case 'wait-invalid':
    case 'calibration':
    case 'statistical-load':
      return {
        icon: '📈',
        cause:
          id === 'wait-invalid'
            ? 'El umbral de espera máxima antes de cancelar debe estar entre 15 y 600 segundos.'
            : id === 'calibration'
              ? 'Sin una tasa de incidencias sanitarias calibrada, el modelo Poisson no puede estimar la demanda simultánea.'
              : 'La tasa estadística prevista supera la capacidad de los equipos sanitarios en más de un 5 % del tiempo.',
        steps: [
          'Completa o ajusta las hipótesis estadísticas en el formulario «Hipótesis del ensayo» justo debajo.',
          ...(id === 'statistical-load'
            ? ['Añade un equipo sanitario adicional o de reserva en Inventario.']
            : []),
        ],
        actions: [
          {
            label: 'Ir al formulario de hipótesis',
            kind: 'focus-risk-form',
            primary: true,
          },
          ...(id === 'statistical-load'
            ? [
                {
                  label: 'Añadir equipo sanitario',
                  kind: 'switch-tool' as const,
                  tool: 'place:medical',
                },
              ]
            : []),
        ],
      };
    case 'pending':
      return {
        icon: '📦',
        cause:
          'Tienes piezas añadidas en el inventario que aún no se han situado sobre el plano.',
        steps: [
          'Coloca las piezas pendientes desde la sección «1. Inventario» de la barra lateral o retíralas del inventario.',
        ],
        actions: [
          {
            label: 'Abrir Inventario',
            kind: 'open-modal',
            modal: 'inventory',
            primary: true,
          },
          {label: 'Ir a Diseñar para ubicarlas', kind: 'focus-panel', panel: 'design'},
        ],
      };
    case 'medical':
      return {
        icon: '✚',
        cause:
          'Hay público previsto pero ningún equipo sanitario activo compatible con el modo de respuesta elegido.',
        steps: [
          'Coloca un «Equipo sanitario» (o «Ambulancia» si el modo es ambulancia) en el plano y verifica su personal y fase «Evento».',
        ],
        actions: [
          {
            label: 'Colocar equipo sanitario',
            kind: 'switch-tool',
            tool:
              scene.responseMode === 'ambulance'
                ? 'place:ambulance'
                : 'place:medical',
            primary: true,
          },
          {label: 'Abrir Inventario', kind: 'open-modal', modal: 'inventory'},
        ],
      };
    case 'security':
      return {
        icon: '◈',
        cause:
          'No hay ninguna patrulla de seguridad activa colocada en el plano para responder a conflictos o incidencias.',
        steps: [
          'Coloca «Policía a pie» (o «Coche policial» si está seleccionado ese modo) en el recinto.',
        ],
        actions: [
          {
            label: 'Colocar equipo de seguridad',
            kind: 'switch-tool',
            tool:
              scene.policeMode === 'patrol'
                ? 'place:patrol'
                : 'place:security',
            primary: true,
          },
        ],
      };
    case 'fire':
      return {
        icon: '🚒',
        cause:
          'Existen puestos de comida con riesgo de incendio de cocina pero no hay dotación de bomberos operativa.',
        steps: [
          'Coloca una dotación de «Bomberos» en un acceso o zona exterior conectada al recinto.',
        ],
        actions: [
          {
            label: 'Colocar bomberos en el plano',
            kind: 'switch-tool',
            tool: 'place:fire',
            primary: true,
          },
        ],
      };
    case 'transfer':
      return {
        icon: '🚑',
        cause:
          'El modo sanitario «Camilla hasta ambulancia» requiere al menos una ambulancia activa para completar el traslado.',
        steps: ['Coloca una «Ambulancia» en el plano cerca de un acceso vehicular.'],
        actions: [
          {
            label: 'Colocar ambulancia',
            kind: 'switch-tool',
            tool: 'place:ambulance',
            primary: true,
          },
        ],
      };
    case 'entry':
    case 'exit':
      return {
        icon: '🚪',
        cause:
          id === 'entry'
            ? 'No existe ningún acceso habilitado para la entrada de público en fase Evento.'
            : 'No existe ningún acceso habilitado como salida pública en fase Evento.',
        steps: [
          'Dibuja un nuevo acceso sobre el borde del perímetro o cambia el «Uso del acceso» de uno existente a «Entrada y salida» o «Acceso libre».',
        ],
        actions: [
          {
            label: 'Dibujar acceso en el plano',
            kind: 'switch-tool',
            tool: 'gateLine',
            primary: true,
          },
        ],
      };
    case 'extinguisher':
      return {
        icon: '🧯',
        cause:
          'Hay puestos de comida pero falta un extintor activo en el plano o no está marcada la formación en primera intervención.',
        steps: [
          'Coloca al menos un «Extintor» cerca de la zona de comida.',
          'Activa «Personal formado para primera intervención» en la Ficha de producción.',
        ],
        actions: [
          {
            label: 'Colocar extintor',
            kind: 'switch-tool',
            tool: 'place:extinguisher',
            primary: true,
          },
          ...(!scene.trained
            ? [
                {
                  label: 'Activar personal formado',
                  kind: 'quick-fix' as const,
                  fixType: 'enable-trained' as const,
                },
              ]
            : []),
        ],
      };
    case 'wet-ground':
      return {
        icon: '☂',
        cause:
          'La simulación está configurada con lluvia: las mesas descubiertas se mojan en 45 s y el público expuesto pierde confort.',
        steps: [
          'Coloca carpas cubriendo mesas picnic y zonas de espera.',
          'Añade personal de secado para recuperar las mesas mojadas con rapidez.',
        ],
        actions: [
          {
            label: 'Colocar carpa',
            kind: 'switch-tool',
            tool: 'place:cover',
            primary: true,
          },
          {
            label: '+1 operario de secado',
            kind: 'quick-fix',
            fixType: 'add-dry-staff',
          },
        ],
      };
    case 'seats':
      return {
        icon: '🪑',
        cause:
          'Las plazas de mesa picnic colocadas son inferiores a las recomendadas por el cálculo de demanda.',
        steps: [
          'Añade más mesas picnic (6 plazas cada una) sobre el plano o desde Inventario.',
        ],
        actions: [
          {
            label: 'Colocar mesa picnic',
            kind: 'switch-tool',
            tool: 'place:picnic',
            primary: true,
          },
          {label: 'Abrir Inventario', kind: 'open-modal', modal: 'inventory'},
        ],
      };
    case 'destroyed':
      return {
        icon: '🔥',
        cause:
          'Un conato de incendio no se sofocó a tiempo y alcanzó el 100 % de daño sobre una estructura.',
        steps: [
          'Coloca un extintor próximo a la zona de comida y activa personal formado en primera intervención.',
          'Acerca la dotación de bomberos, verifica el acceso de vehículos pesados y separa los puestos al menos 3 m para evitar propagación.',
        ],
        actions: [
          {
            label: 'Colocar extintor',
            kind: 'switch-tool',
            tool: 'place:extinguisher',
            primary: true,
          },
          {
            label: 'Ajustar parámetros de incendio',
            kind: 'open-modal',
            modal: 'parameters',
          },
        ],
      };
    case 'evacuation-blocked':
      return {
        icon: '🚨',
        cause:
          'Durante la orden de desalojo, parte del público quedó sin ruta libre hacia una salida.',
        steps: [
          'Añade más salidas en puntos opuestos del perímetro.',
          'Elimina vallas o estrechamientos que bloqueen el flujo de evacuación.',
        ],
        actions: [
          {
            label: 'Dibujar salida adicional',
            kind: 'switch-tool',
            tool: 'gateLine',
            primary: true,
          },
          {label: 'Ir al plano a despejar', kind: 'focus-panel', panel: 'design'},
        ],
      };
    case 'technical':
    default:
      return {
        icon: '📋',
        cause:
          'Recordatorio metodológico: el simulador orienta el diseño pero requiere validación técnica y municipal externa.',
        steps: [
          'Exporta la revisión de riesgos y adjúntala al plan de autoprotección y revisión en campo.',
        ],
        actions: [
          {
            label: 'Ver fuentes y precisión',
            kind: 'open-modal',
            modal: 'info',
          },
        ],
      };
  }
}
