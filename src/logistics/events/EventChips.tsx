/**
 * Status and verification chips for an event, using the certainty grammar.
 */
import React from 'react';
import type {
  EventStatus,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {
  STATUS_HELP,
  STATUS_LABEL,
  VERIFICATION_HELP,
  VERIFICATION_LABEL,
} from '../lib/events';
import {Chip} from '../ui';

export const StatusChip: React.FC<{
  status: EventStatus;
  size?: 'sm' | 'md';
}> = ({status, size = 'sm'}) => {
  const label = STATUS_LABEL[status];
  const title = STATUS_HELP[status];
  switch (status) {
    case 'confirmed':
      return (
        <Chip certainty="confirmed" size={size} title={title}>
          {label}
        </Chip>
      );
    case 'delayed':
      return (
        <Chip certainty="confirmed" tone="danger" size={size} title={title}>
          {label}
        </Chip>
      );
    case 'cancelled':
      return (
        <Chip tag tone="neutral" struck size={size} title={title}>
          {label}
        </Chip>
      );
    default:
      return (
        <Chip certainty="planned" size={size} title={title}>
          {label}
        </Chip>
      );
  }
};

export const VerificationChip: React.FC<{
  verification: Verification;
  size?: 'sm' | 'md';
}> = ({verification, size = 'sm'}) => (
  <Chip
    certainty={verification === 'validated' ? 'confirmed' : 'pending'}
    tone={verification === 'validated' ? 'accent' : 'neutral'}
    size={size}
    title={VERIFICATION_HELP[verification]}
  >
    {VERIFICATION_LABEL[verification]}
  </Chip>
);

export const DemoChip: React.FC = () => (
  <Chip
    tag
    tone="neutral"
    size="sm"
    title="Dato ficticio de demostración; se puede quitar en un paso."
  >
    Demo
  </Chip>
);
