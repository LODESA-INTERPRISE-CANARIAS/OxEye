/**
 * Venue column widths and collapsed venues, remembered on this device (like
 * the hour scale). Not shared with the team: each screen has its own room.
 */
import {useCallback, useState} from 'react';
import {parseColumnPrefs, withColumnPref, type ColumnPrefs} from './layout';

export const COLUMN_PREFS_KEY = 'oxeye.logistics.calendar-columns.v1';

function read(): ColumnPrefs {
  try {
    return parseColumnPrefs(localStorage.getItem(COLUMN_PREFS_KEY));
  } catch {
    return {};
  }
}

function write(prefs: ColumnPrefs) {
  try {
    if (Object.keys(prefs).length) {
      localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(prefs));
    } else {
      localStorage.removeItem(COLUMN_PREFS_KEY);
    }
  } catch {
    // Not remembered; the columns go back to automatic next time.
  }
}

export function useColumnPrefs() {
  const [prefs, setPrefs] = useState<ColumnPrefs>(read);

  const update = useCallback(
    (key: string, patch: {width?: number | null; collapsed?: boolean}) => {
      setPrefs(current => {
        const next = withColumnPref(current, key, patch);
        write(next);
        return next;
      });
    },
    [],
  );

  const setWidth = useCallback(
    (key: string, width: number | null) => update(key, {width}),
    [update],
  );
  const setCollapsed = useCallback(
    (key: string, collapsed: boolean) => update(key, {collapsed}),
    [update],
  );

  return {prefs, setWidth, setCollapsed};
}
