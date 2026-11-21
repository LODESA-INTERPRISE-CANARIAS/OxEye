import React, {useMemo, useRef, useState} from 'react';
import {
  type AddressSearchResult,
  clampLat,
  latLonToTileFloat,
  searchAddress,
  tileToLatLon,
  tileUrl,
} from '../../engine/cartography/custom-map';
import type {CustomLocationConfig} from '../../types';

const TILE_SIZE = 256;
const EARTH_CIRCUMFERENCE = 40075016.68557849;

export interface LocationPickerProps {
  value: CustomLocationConfig;
  onChange: (next: CustomLocationConfig) => void;
  onLabelPicked?: (shortName: string) => void;
}

/**
 * Selector interactivo de ubicación sobre mapa real OpenStreetMap con buscador de
 * direcciones (Nominatim) y marco cuadrado ajustable desde el centro elegido.
 */
export const LocationPicker: React.FC<LocationPickerProps> = ({
  value,
  onChange,
  onLabelPicked,
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startTileX: number;
    startTileY: number;
    moved: boolean;
  } | null>(null);

  const [zoom, setZoom] = useState(16);
  const [viewCenter, setViewCenter] = useState<{lat: number; lon: number}>({
    lat: value.lat,
    lon: value.lon,
  });
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<AddressSearchResult[]>([]);
  const [viewportSize, setViewportSize] = useState<{w: number; h: number}>({
    w: 580,
    h: 250,
  });

  const measureViewport = () => {
    const el = viewportRef.current;
    if (!el) return {w: viewportSize.w, h: viewportSize.h};
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      if (
        Math.abs(r.width - viewportSize.w) > 2 ||
        Math.abs(r.height - viewportSize.h) > 2
      ) {
        setViewportSize({w: r.width, h: r.height});
      }
      return {w: r.width, h: r.height};
    }
    return viewportSize;
  };

  const [centerTileX, centerTileY] = useMemo(
    () => latLonToTileFloat(viewCenter.lat, viewCenter.lon, zoom),
    [viewCenter.lat, viewCenter.lon, zoom]
  );

  const [pinTileX, pinTileY] = useMemo(
    () => latLonToTileFloat(value.lat, value.lon, zoom),
    [value.lat, value.lon, zoom]
  );

  // Metros reales por píxel en el zoom actual y latitud seleccionada
  const metersPerPixel = useMemo(() => {
    const cosLat = Math.max(0.05, Math.cos((clampLat(value.lat) * Math.PI) / 180));
    return (EARTH_CIRCUMFERENCE * cosLat) / (TILE_SIZE * 2 ** zoom);
  }, [value.lat, zoom]);

  const squarePx = Math.max(18, value.sizeMeters / metersPerPixel);
  const pinOffsetX = (pinTileX - centerTileX) * TILE_SIZE;
  const pinOffsetY = (pinTileY - centerTileY) * TILE_SIZE;

  const tiles = useMemo(() => {
    const halfCols = Math.ceil(viewportSize.w / TILE_SIZE / 2) + 1;
    const halfRows = Math.ceil(viewportSize.h / TILE_SIZE / 2) + 1;
    const baseTx = Math.floor(centerTileX);
    const baseTy = Math.floor(centerTileY);
    const maxIdx = 2 ** zoom - 1;
    const list: Array<{
      key: string;
      url: string;
      left: number;
      top: number;
    }> = [];
    for (let dy = -halfRows; dy <= halfRows; dy++) {
      const ty = baseTy + dy;
      if (ty < 0 || ty > maxIdx) continue;
      for (let dx = -halfCols; dx <= halfCols; dx++) {
        const tx = ((baseTx + dx) % (maxIdx + 1) + (maxIdx + 1)) % (maxIdx + 1);
        const left = (baseTx + dx - centerTileX) * TILE_SIZE;
        const top = (ty - centerTileY) * TILE_SIZE;
        list.push({
          key: `${zoom}-${tx}-${ty}-${dx}`,
          url: tileUrl(zoom, tx, ty, 'plan'),
          left,
          top,
        });
      }
    }
    return list;
  }, [centerTileX, centerTileY, zoom, viewportSize.w, viewportSize.h]);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError('');
    try {
      const found = await searchAddress(q);
      setResults(found);
      if (!found.length) {
        setSearchError('No se encontraron direcciones para esa búsqueda.');
      }
    } catch {
      setSearchError(
        'No se pudo conectar con el buscador. Puedes hacer clic directamente sobre el mapa.'
      );
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const selectSearchResult = (res: AddressSearchResult) => {
    const shortName = res.label.split(',').slice(0, 2).join(', ').trim();
    setViewCenter({lat: res.lat, lon: res.lon});
    setZoom((z) => Math.max(16, z));
    onChange({
      ...value,
      lat: res.lat,
      lon: res.lon,
      label: shortName || res.label,
    });
    if (onLabelPicked && shortName) {
      onLabelPicked(shortName.slice(0, 80));
    }
    setResults([]);
    setSearchError('');
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    measureViewport();
    const [tx, ty] = latLonToTileFloat(viewCenter.lat, viewCenter.lon, zoom);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTileX: tx,
      startTileY: ty,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const nextTx = drag.startTileX - dx / TILE_SIZE;
    const nextTy = drag.startTileY - dy / TILE_SIZE;
    const maxN = 2 ** zoom;
    const clampedTy = Math.max(0.01, Math.min(maxN - 0.01, nextTy));
    const nextPos = tileToLatLon(nextTx, clampedTy, zoom);
    setViewCenter({
      lat: clampLat(nextPos.lat),
      lon: ((((nextPos.lon + 180) % 360) + 360) % 360) - 180,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if capture already released
    }
    if (!drag || drag.moved) return;
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clickX = e.clientX - rect.left - rect.width / 2;
    const clickY = e.clientY - rect.top - rect.height / 2;
    const targetTx = centerTileX + clickX / TILE_SIZE;
    const targetTy = centerTileY + clickY / TILE_SIZE;
    const maxN = 2 ** zoom;
    const clampedTy = Math.max(0.01, Math.min(maxN - 0.01, targetTy));
    const pos = tileToLatLon(targetTx, clampedTy, zoom);
    const lat = clampLat(pos.lat);
    const lon = ((((pos.lon + 180) % 360) + 360) % 360) - 180;
    const isGenericLabel =
      !value.label.trim() ||
      value.label.startsWith('Punto seleccionado') ||
      value.label === 'Plaza del Cristo, San Cristóbal de La Laguna';
    onChange({
      ...value,
      lat,
      lon,
      label: isGenericLabel
        ? `Punto seleccionado (${lat.toFixed(4)}, ${lon.toFixed(4)})`
        : value.label,
    });
  };

  return (
    <div className="location-picker" id="location-picker">
      <div className="location-search-bar">
        <input
          id="location-search-input"
          type="search"
          placeholder="Buscar dirección, plaza o municipio..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSearch();
            }
          }}
        />
        <button
          type="button"
          id="location-search-btn"
          className="location-search-btn"
          disabled={searching}
          onClick={() => void handleSearch()}
        >
          {searching ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      {searchError && <p className="location-search-error">{searchError}</p>}

      {results.length > 0 && (
        <ul
          className="location-search-results"
          id="location-search-results"
          role="listbox"
          aria-label="Resultados de direcciones"
        >
          {results.map((r, idx) => (
            <li key={`${r.lat}-${r.lon}-${idx}`}>
              <button
                type="button"
                className="location-result-btn"
                onClick={() => selectSearchResult(r)}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        ref={viewportRef}
        id="location-picker-map"
        className="location-map-viewport"
        role="application"
        aria-label="Mapa interactivo para elegir el centro de la escena. Haz clic para fijar el centro o arrastra para desplazar."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="location-map-tiles">
          {tiles.map((t) => (
            <img
              key={t.key}
              src={t.url}
              alt=""
              draggable={false}
              style={{
                transform: `translate(${t.left}px, ${t.top}px)`,
              }}
            />
          ))}
        </div>

        <div
          className="location-square-overlay"
          style={{
            width: `${squarePx}px`,
            height: `${squarePx}px`,
            transform: `translate(calc(-50% + ${pinOffsetX}px), calc(-50% + ${pinOffsetY}px))`,
          }}
        >
          <span className="location-square-badge">
            {value.sizeMeters} × {value.sizeMeters} m
          </span>
          <span className="location-center-pin" title="Centro de la escena" />
        </div>

        <div className="location-map-controls">
          <button
            type="button"
            id="location-zoom-in"
            aria-label="Acercar mapa"
            onClick={() => setZoom((z) => Math.min(18, z + 1))}
          >
            +
          </button>
          <button
            type="button"
            id="location-zoom-out"
            aria-label="Alejar mapa"
            onClick={() => setZoom((z) => Math.max(13, z - 1))}
          >
            −
          </button>
          <button
            type="button"
            id="location-recenter"
            title="Centrar en el punto elegido"
            aria-label="Centrar en el punto elegido"
            onClick={() => setViewCenter({lat: value.lat, lon: value.lon})}
          >
            ◎
          </button>
        </div>

        <span className="location-map-hint">
          Haz clic para fijar el centro · Arrastra para mover
        </span>
      </div>

      <div className="location-size-control">
        <div className="location-size-head">
          <span>Área cuadrada desde el centro</span>
          <b id="location-size-readout">
            {value.sizeMeters} × {value.sizeMeters} m ({value.sizeMeters / 2} m
            hacia cada lado)
          </b>
        </div>
        <input
          id="location-size-slider"
          type="range"
          min={200}
          max={600}
          step={50}
          value={value.sizeMeters}
          onChange={(e) =>
            onChange({...value, sizeMeters: Number(e.target.value)})
          }
        />
        <label className="location-zone-name-field">
          <span>Nombre de la zona / recinto</span>
          <input
            id="location-zone-name"
            type="text"
            maxLength={100}
            placeholder="Ej. Plaza del Tranvía, Parque García Sanabria…"
            value={value.label}
            onChange={(e) => onChange({...value, label: e.target.value})}
          />
        </label>
        <div className="location-coords-row">
          <span className="location-label-text">Coordenadas del centro</span>
          <code>
            {value.lat.toFixed(5)}, {value.lon.toFixed(5)}
          </code>
        </div>
      </div>
    </div>
  );
};
