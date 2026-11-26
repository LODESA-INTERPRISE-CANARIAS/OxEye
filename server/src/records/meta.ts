/**
 * Shared shape of mutable records: SQL column list and row → RecordMeta
 * mapping. Queries select the meta columns with the aliases below.
 */
import {toIso} from '../db/db.ts';
import type {
  DataSource,
  RecordMeta,
  Verification,
} from '../../../shared/logistics/contracts.ts';

export interface MetaRow {
  id: string;
  version: number;
  created_by: string;
  created_by_name: string;
  created_at: unknown;
  updated_by: string;
  updated_by_name: string;
  updated_at: unknown;
  source: DataSource | null;
  verification: Verification;
  is_demo: boolean;
}

/** Meta columns of table alias `t`, with author names from `cu` / `uu`. */
export function metaColumns(t: string): string {
  return `${t}.id, ${t}.version, ${t}.created_by, cu.display_name AS created_by_name,
    ${t}.created_at, ${t}.updated_by, uu.display_name AS updated_by_name,
    ${t}.updated_at, ${t}.source, ${t}.verification, ${t}.is_demo`;
}

/** Joins that provide `cu` and `uu` for table alias `t`. */
export function authorJoins(t: string): string {
  return `JOIN users cu ON cu.id = ${t}.created_by JOIN users uu ON uu.id = ${t}.updated_by`;
}

export function toMeta(row: MetaRow): RecordMeta {
  return {
    id: row.id,
    version: Number(row.version),
    createdBy: {id: row.created_by, displayName: row.created_by_name},
    createdAt: toIso(row.created_at),
    updatedBy: {id: row.updated_by, displayName: row.updated_by_name},
    updatedAt: toIso(row.updated_at),
    source: row.source,
    verification: row.verification,
    isDemo: Boolean(row.is_demo),
  };
}
