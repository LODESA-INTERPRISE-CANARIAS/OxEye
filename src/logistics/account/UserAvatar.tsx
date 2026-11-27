/**
 * A person's avatar (Revisión 1 · E4): the profile photo when there is one
 * and the viewer may see it, otherwise the initials on the person's accent.
 * Pass `avatarId`/`accent` when known; with only `userId` they come from
 * the organization's members.
 */
import React from 'react';
import type {Uuid} from '../../../shared/logistics/contracts.ts';
import {useMediaSrc} from '../inventory/media-cache';
import {initials} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {useMember} from './members';

/** Accent keys a profile may choose; null = the palette's own accent. */
export const ACCENTS: {key: string; label: string}[] = [
  {key: 'medio', label: 'Acento claro'},
  {key: 'lavanda', label: 'Lavanda'},
  {key: 'oro', label: 'Oro'},
  {key: 'tinta', label: 'Tinta'},
];

export interface UserAvatarProps {
  name: string;
  userId?: Uuid | null;
  avatarId?: Uuid | null;
  accent?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  userId,
  avatarId,
  accent,
  size = 'md',
  className,
}) => {
  const member = useMember(avatarId === undefined ? userId : null);
  // Profile photos are for members only (the server answers 404 to guests).
  const guest = useLogisticsStore(s => s.session?.user.role !== 'member');
  const photo = avatarId === undefined ? (member?.avatarId ?? null) : avatarId;
  const tone = accent === undefined ? (member?.accent ?? null) : accent;
  const {src} = useMediaSrc(guest ? null : photo);
  return (
    <span
      className={[
        'lx-avatar',
        size !== 'md' ? `lx-avatar--${size}` : '',
        src ? 'lx-avatar--photo' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-accent={tone ?? undefined}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
};
