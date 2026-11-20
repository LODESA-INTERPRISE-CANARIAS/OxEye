import React from 'react';
import {world} from '../../engine/cartography/geometry';
import {wallMetrics} from '../../engine/subsoil/heat';
import {useProjectStore} from '../../store/useProjectStore';
import type {Point2D} from '../../types';
import {isXrayTool} from './selectionActions';

/**
 * Capa SVG dedicada (`#xray-layer`) para la visualización y edición de la
 * estructura del subsuelo (perímetro booleano, columnas, muros de carga y
 * mapa de calor estructural semitransparente).
 *
 * - Independiente de `#heat-layer` (reservada a las lentes Flujos y Esperas).
 * - Totalmente vacía cuando `xrayVisible` es `false`.
 * - No captura eventos de puntero salvo cuando una herramienta de Rayos X
 *   está activa en el espacio Diseñar.
 */
export const XRayLayer: React.FC = () => {
  const xrayVisible = useProjectStore((s) => s.xrayVisible);
  const panel = useProjectStore((s) => s.panel);
  const tool = useProjectStore((s) => s.tool);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const revision = useProjectStore((s) => s.revision);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);

  void revision;

  if (!xrayVisible) {
    return <g id="xray-layer" pointerEvents="none" />;
  }

  const scene = currentScene();
  const map = currentMap();
  const subsoil = scene.subsoil;
  const interactive = panel === 'design' && isXrayTool(tool);
  const selectedSet = new Set(selectedIds);
  const singleSelectedId = selectedIds.length === 1 ? selectedIds[0] : null;

  const toPointsAttr = (pts: Point2D[]): string =>
    pts.map((p) => world(p, map).join(',')).join(' ');

  const polygons = subsoil?.polygons || [];
  const columns = subsoil?.columns || [];
  const walls = subsoil?.walls || [];
  const hasPerimeter = polygons.some((p) => p.op === 'add' && p.points.length >= 3);

  return (
    <g
      id="xray-layer"
      className="xray-layer"
      pointerEvents={interactive ? 'auto' : 'none'}
    >
      <defs>
        <pattern
          id="xray-hatch"
          width="3"
          height="3"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="3"
            stroke="#4b2665"
            strokeOpacity="0.22"
            strokeWidth="0.45"
          />
        </pattern>
        <radialGradient id="xray-col-heat" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#c81d4e" stopOpacity="0.82" />
          <stop offset="35%" stopColor="#e64a3b" stopOpacity="0.58" />
          <stop offset="70%" stopColor="#f29b38" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#f29b38" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="xray-wall-heat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f29b38" stopOpacity="0" />
          <stop offset="22%" stopColor="#f29b38" stopOpacity="0.32" />
          <stop offset="44%" stopColor="#e64a3b" stopOpacity="0.68" />
          <stop offset="50%" stopColor="#c81d4e" stopOpacity="0.82" />
          <stop offset="56%" stopColor="#e64a3b" stopOpacity="0.68" />
          <stop offset="78%" stopColor="#f29b38" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#f29b38" stopOpacity="0" />
        </linearGradient>
        {hasPerimeter && (
          <mask id="xray-subsoil-mask">
            <rect
              x="0"
              y="0"
              width={map.widthMeters}
              height={map.heightMeters}
              fill="black"
            />
            {polygons.map((poly) => (
              <polygon
                key={poly.id}
                points={toPointsAttr(poly.points)}
                fill={poly.op === 'add' ? 'white' : 'black'}
              />
            ))}
          </mask>
        )}
      </defs>

      {/* Perímetro booleano del subsuelo */}
      {hasPerimeter && (
        <g className="xray-perimeter" pointerEvents="none">
          <rect
            x="0"
            y="0"
            width={map.widthMeters}
            height={map.heightMeters}
            fill="#4b2665"
            fillOpacity="0.14"
            mask="url(#xray-subsoil-mask)"
          />
          <rect
            x="0"
            y="0"
            width={map.widthMeters}
            height={map.heightMeters}
            fill="url(#xray-hatch)"
            mask="url(#xray-subsoil-mask)"
          />
        </g>
      )}

      {/* Contornos de polígonos del subsuelo */}
      {polygons.map((poly) => {
        const isSel = selectedSet.has(poly.id);
        return (
          <polygon
            key={poly.id}
            data-id={poly.id}
            data-xray-kind="polygon"
            className="xray-polygon"
            points={toPointsAttr(poly.points)}
            fill="none"
            stroke={
              isSel
                ? '#c49a45'
                : poly.op === 'add'
                  ? '#5b2c86'
                  : '#b43c4c'
            }
            strokeWidth={isSel ? 0.85 : 0.55}
            strokeDasharray={poly.op === 'add' ? '2.4 1.2' : '1.2 1.2'}
          >
            <title>
              {poly.name ||
                (poly.op === 'add'
                  ? 'Perímetro subsuelo (+)'
                  : 'Área restada subsuelo (−)')}
            </title>
          </polygon>
        );
      })}

      {/* Mapa de calor estructural (semitransparente, nunca captura puntero) */}
      <g id="xray-heatmap" className="xray-heatmap" pointerEvents="none">
        {columns.map((col) => {
          const [cx, cy] = world([col.x, col.y], map);
          const totalR = Math.max(0.1, col.diameter / 2 + col.influenceRadius);
          return (
            <circle
              key={`heat-${col.id}`}
              data-xray-heat-column={col.id}
              cx={cx}
              cy={cy}
              r={totalR}
              fill="url(#xray-col-heat)"
            />
          );
        })}
        {walls.map((wall) => {
          const m = wallMetrics(wall, map);
          const halfBand = Math.max(
            0.1,
            wall.thickness / 2 + wall.influenceDepth
          );
          const bandHeight = halfBand * 2;
          const bandWidth = m.length + halfBand * 2;
          return (
            <g
              key={`heat-${wall.id}`}
              data-xray-heat-wall={wall.id}
              transform={`translate(${m.midMeters[0]} ${m.midMeters[1]}) rotate(${m.angleDeg})`}
            >
              <rect
                x={-bandWidth / 2}
                y={-halfBand}
                width={bandWidth}
                height={bandHeight}
                rx={halfBand}
                fill="url(#xray-wall-heat)"
              />
            </g>
          );
        })}
      </g>

      {/* Muros de carga */}
      {walls.map((wall) => {
        const m = wallMetrics(wall, map);
        const isSel = selectedSet.has(wall.id);
        const showHandles = panel === 'design' && singleSelectedId === wall.id;
        const thick = Math.max(0.25, wall.thickness);
        return (
          <g
            key={wall.id}
            data-id={wall.id}
            data-xray-kind="wall"
            className="xray-item xray-wall"
          >
            <title>
              {wall.name} · {m.length.toFixed(1)} m (grosor {wall.thickness} m)
            </title>
            {/* Área de impacto más cómoda para seleccionar el muro */}
            <line
              x1={m.aMeters[0]}
              y1={m.aMeters[1]}
              x2={m.bMeters[0]}
              y2={m.bMeters[1]}
              stroke="transparent"
              strokeWidth={Math.max(2.2, thick + 1.2)}
            />
            {/* Borde de selección */}
            {isSel && (
              <line
                x1={m.aMeters[0]}
                y1={m.aMeters[1]}
                x2={m.bMeters[0]}
                y2={m.bMeters[1]}
                stroke="#c49a45"
                strokeWidth={thick + 1.1}
                strokeLinecap="square"
                strokeOpacity="0.65"
              />
            )}
            {/* Núcleo estructural grueso del muro de carga */}
            <line
              x1={m.aMeters[0]}
              y1={m.aMeters[1]}
              x2={m.bMeters[0]}
              y2={m.bMeters[1]}
              stroke="#2c163d"
              strokeWidth={thick}
              strokeLinecap="butt"
            />
            {/* Doble línea central para distinguirlo de vallas y perímetros */}
            <line
              x1={m.aMeters[0]}
              y1={m.aMeters[1]}
              x2={m.bMeters[0]}
              y2={m.bMeters[1]}
              stroke="#e9dbf8"
              strokeWidth={Math.max(0.1, thick * 0.28)}
              strokeDasharray="1.1 0.55"
              strokeLinecap="butt"
            />
            {/* Asas de extremos A y B para mover/rotar el muro */}
            {showHandles && (
              <>
                <circle
                  data-xray-handle="a"
                  data-wall-id={wall.id}
                  cx={m.aMeters[0]}
                  cy={m.aMeters[1]}
                  r="1.15"
                  fill="#ffffff"
                  stroke="#4b2665"
                  strokeWidth="0.35"
                  className="xray-wall-handle"
                />
                <circle
                  data-xray-handle="b"
                  data-wall-id={wall.id}
                  cx={m.bMeters[0]}
                  cy={m.bMeters[1]}
                  r="1.15"
                  fill="#ffffff"
                  stroke="#4b2665"
                  strokeWidth="0.35"
                  className="xray-wall-handle"
                />
              </>
            )}
          </g>
        );
      })}

      {/* Columnas estructurales */}
      {columns.map((col) => {
        const [cx, cy] = world([col.x, col.y], map);
        const r = Math.max(0.25, col.diameter / 2);
        const isSel = selectedSet.has(col.id);
        const cross = r * 0.6;
        return (
          <g
            key={col.id}
            data-id={col.id}
            data-xray-kind="column"
            className="xray-item xray-column"
          >
            <title>
              {col.name} · Ø {col.diameter} m · influencia {col.influenceRadius}{' '}
              m
            </title>
            <circle cx={cx} cy={cy} r={Math.max(1.2, r + 0.5)} fill="transparent" />
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="#2c163d"
              stroke={isSel ? '#c49a45' : '#dfd0f2'}
              strokeWidth={isSel ? 0.45 : 0.25}
            />
            <path
              d={`M${cx - cross},${cy}L${cx + cross},${cy}M${cx},${cy - cross}L${cx},${cy + cross}`}
              stroke="#dfd0f2"
              strokeWidth="0.16"
              pointerEvents="none"
            />
            {isSel && (
              <circle
                className="selection-ring"
                cx={cx}
                cy={cy}
                r={r + 0.9}
              />
            )}
          </g>
        );
      })}
    </g>
  );
};
