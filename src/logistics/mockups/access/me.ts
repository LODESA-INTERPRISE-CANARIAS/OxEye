/** The signed-in person of the F2 mock-ups, kept in React state only. */
import type {RoleId} from '../data';

export type AccentId = 'accent' | 'secondary' | 'ink';

export const ACCENTS: {id: AccentId; label: string}[] = [
  {id: 'accent', label: 'Acento'},
  {id: 'secondary', label: 'Secundario'},
  {id: 'ink', label: 'Tinta'},
];

export interface Me {
  username: string;
  displayName: string;
  roles: RoleId[];
  photo: string | null;
  description: string;
  email: string;
  emailState: 'none' | 'pending' | 'verified';
  provisional: boolean;
  /** Tone of the avatar ring and the profile header, from palette tokens. */
  accent: AccentId;
}

export function meFor(username: string): Me {
  if (username === 'Fabián') {
    return {
      username,
      displayName: 'Fabián',
      roles: ['admin', 'developer'],
      photo: null,
      description: 'Desarrollo de OxEye',
      email: 'fabian@example.com',
      emailState: 'verified',
      provisional: false,
      accent: 'accent',
    };
  }
  return {
    username,
    displayName: username,
    roles: username === 'Equipo' ? ['team'] : ['admin'],
    photo: null,
    description: '',
    email: '',
    emailState: 'none',
    provisional: true,
    accent: 'accent',
  };
}
