import React from 'react';
import {useProjectStore} from '../../store/useProjectStore';
import {useWorkspaceStore} from '../../store/useWorkspaceStore';

/**
 * Map banner shown while «Editar recinto» is active (`#venue-mode-banner`,
 * OX-04 D7): changes apply to every layout that uses the venue.
 */
export const EditModeBanner: React.FC = () => {
  const editMode = useWorkspaceStore((s) => s.editMode);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const hasLayout = useWorkspaceStore((s) => !!s.activeLayoutIds[activeVenue]);
  if (editMode !== 'venue' || !hasLayout) return null;
  return (
    <div id="venue-mode-banner" className="venue-mode-banner" role="status">
      <span>
        Editando el recinto: los cambios afectan a todas las distribuciones que lo usan.
      </span>
      <button
        type="button"
        id="venue-mode-exit"
        onClick={() => void useWorkspaceStore.getState().setEditMode('layout')}
      >
        Terminar edición del recinto
      </button>
    </div>
  );
};
