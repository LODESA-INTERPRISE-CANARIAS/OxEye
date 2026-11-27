/**
 * Which account sheet is open (Revisión 1 · E4): «Tu espacio en Ox Eye»
 * (profile, security, activity) or «Usuarios» (administration). A small
 * store of its own, so any entry point (sidebar, phone account sheet,
 * banners, «Sin acceso» notices) opens them without passing callbacks.
 */
import {create} from 'zustand';

export type ProfileTab = 'perfil' | 'seguridad' | 'actividad';

export type AccountView =
  | {kind: 'profile'; tab: ProfileTab; focus?: 'password' | 'email'}
  | {kind: 'users'};

interface AccountUiState {
  view: AccountView | null;
  /** Bumped on every opening, so the sheet remounts fresh. */
  seq: number;
  openProfile: (tab?: ProfileTab, focus?: 'password' | 'email') => void;
  /** Profile on its security tab with the password form in view. */
  openPasswordChange: () => void;
  openUsers: () => void;
  close: () => void;
}

export const useAccountUi = create<AccountUiState>(set => ({
  view: null,
  seq: 0,
  openProfile: (tab = 'perfil', focus) =>
    set(s => ({view: {kind: 'profile', tab, focus}, seq: s.seq + 1})),
  openPasswordChange: () =>
    set(s => ({
      view: {kind: 'profile', tab: 'seguridad', focus: 'password'},
      seq: s.seq + 1,
    })),
  openUsers: () => set(s => ({view: {kind: 'users'}, seq: s.seq + 1})),
  close: () => set({view: null}),
}));
