import {useEffect} from 'react';
import {
  groupSelection,
  ungroupTopLevel,
} from '../../engine/cartography/groups';
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
 * - `Ctrl+G`: agrupar elementos seleccionados (soporta niveles anidados)
 * - `Mayús+G` (o `Ctrl+Mayús+G`): deshacer el último nivel de agrupación
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

      // Agrupar selección (Ctrl+G)
      if (mod && !e.shiftKey && key === 'g') {
        if (state.panel !== 'design' || state.selectedIds.length < 2) return;
        e.preventDefault();
        let memberLeafIds: string[] = [];
        state.updateScene((sc) => {
          const res = groupSelection(sc, state.selectedIds);
          if (res) memberLeafIds = res.memberLeafIds;
        }, true);
        if (memberLeafIds.length) {
          state.setSelectedIds(memberLeafIds);
          onSceneChanged();
          state.showToast(
            `Agrupados ${memberLeafIds.length} elementos · Mayús+G para desagrupar`
          );
        } else {
          state.showToast('Selecciona al menos dos elementos o subgrupos distintos');
        }
        return;
      }

      // Desagrupar último nivel (Mayús+G o Ctrl+Mayús+G)
      if (e.shiftKey && key === 'g') {
        if (state.panel !== 'design' || !state.selectedIds.length) return;
        e.preventDefault();
        let remainingLeafIds: string[] = [];
        let dissolved = 0;
        state.updateScene((sc) => {
          const res = ungroupTopLevel(sc, state.selectedIds);
          if (res) {
            dissolved = res.dissolvedGroupIds.length;
            remainingLeafIds = res.remainingLeafIds;
          }
        }, true);
        if (dissolved > 0) {
          state.setSelectedIds(remainingLeafIds);
          onSceneChanged();
          state.showToast('Último nivel de agrupación deshecho');
        }
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
              ? `${pastedIds.length} pegados · límite de 500 piezas alcanzado`
              : pastedIds.length === 1
                ? 'Elemento pegado'
                : `${pastedIds.length} elementos pegados`
          );
        } else if (skippedLimit > 0) {
          state.showToast('Límite del prototipo: 500 elementos por espacio');
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
