import {useEffect} from 'react';
import {useProjectStore} from '../../store/useProjectStore';
import {
  copyItemsFromScene,
  deleteItemsFromScene,
  isEditableEventTarget,
  pasteItemsIntoScene,
} from './selectionActions';

/**
 * Hook global de atajos de teclado para el lienzo:
 * - `Ctrl+C` / `Ctrl+V`: copiar y pegar selección (única o múltiple)
 * - `Supr` (`Delete`): eliminar selección respetando elementos `locked`
 * - `Ctrl+Z` / `Ctrl+Y` (y `Ctrl+Shift+Z`): deshacer / rehacer
 *
 * Ignora eventos mientras el usuario escribe en inputs/textareas, o cuando
 * está abierto el menú principal o un diálogo modal.
 */
export function useMapShortcuts(
  onSceneChanged: () => void,
  onUndoRedo: (isRedo?: boolean) => void
): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableEventTarget(e.target)) return;
      const state = useProjectStore.getState();
      if (state.menuOpen || state.activeModal !== null) return;

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Deshacer / Rehacer
      if (mod && key === 'z' && !e.shiftKey) {
        if (state.panel === 'simulate') return;
        e.preventDefault();
        onUndoRedo(false);
        return;
      }
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        if (state.panel === 'simulate') return;
        e.preventDefault();
        onUndoRedo(true);
        return;
      }

      // Copiar (Ctrl+C)
      if (mod && key === 'c') {
        if (state.panel === 'simulate' || !state.selectedIds.length) return;
        const payload = copyItemsFromScene(
          state.currentScene(),
          state.selectedIds
        );
        if (!payload.entries.length) return;
        e.preventDefault();
        state.setClipboard(payload);
        state.showToast(
          payload.entries.length === 1
            ? 'Elemento copiado'
            : `${payload.entries.length} elementos copiados`
        );
        return;
      }

      // Pegar (Ctrl+V)
      if (mod && key === 'v') {
        if (state.panel === 'simulate' || !state.clipboard?.entries.length) {
          return;
        }
        e.preventDefault();
        let pastedIds: string[] = [];
        let skippedLimit = 0;
        const clip = state.clipboard;
        const map = state.currentMap();
        state.updateScene((sc) => {
          const res = pasteItemsIntoScene(
            sc,
            clip,
            map,
            state.grid,
            state.panel
          );
          pastedIds = res.newIds;
          skippedLimit = res.skippedCatalogLimit;
        }, true);
        if (pastedIds.length) {
          state.setSelectedIds(pastedIds);
          onSceneChanged();
          state.showToast(
            skippedLimit > 0
              ? `${pastedIds.length} pegados · límite de 150 piezas alcanzado`
              : pastedIds.length === 1
                ? 'Elemento pegado'
                : `${pastedIds.length} elementos pegados`
          );
        } else if (skippedLimit > 0) {
          state.showToast('Límite del prototipo: 150 elementos por espacio');
        }
        return;
      }

      // Eliminar (Supr)
      if (e.key === 'Delete') {
        if (state.panel === 'simulate' || !state.selectedIds.length) return;
        e.preventDefault();
        const idsToDelete = [...state.selectedIds];
        let deletedCount = 0;
        let lockedIds: string[] = [];
        state.updateScene((sc) => {
          const res = deleteItemsFromScene(sc, idsToDelete, state.panel);
          deletedCount = res.deletedIds.length;
          lockedIds = res.lockedIds;
        }, true);
        if (deletedCount > 0) {
          state.setSelectedIds(lockedIds);
          onSceneChanged();
          if (lockedIds.length) {
            state.showToast(
              `${deletedCount} eliminados · ${lockedIds.length} bloqueados conservados`
            );
          } else {
            state.showToast(
              deletedCount === 1
                ? 'Elemento eliminado'
                : `${deletedCount} elementos eliminados`
            );
          }
        } else if (lockedIds.length) {
          state.showToast(
            'Elemento bloqueado: desactiva el bloqueo antes de eliminarlo'
          );
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSceneChanged, onUndoRedo]);
}
