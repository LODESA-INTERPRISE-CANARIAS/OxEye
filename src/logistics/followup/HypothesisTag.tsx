/**
 * The visible word «Hipótesis» inside a hypothesis chip, so it never relies
 * on the dashed line or the tint alone (full sun, colour blindness).
 */
import React from 'react';
import {Icon} from '../ui';

export const HypothesisTag: React.FC = () => (
  <span className="lx-hypotag">
    <Icon name="flask" size={12} />
    Hipótesis
  </span>
);
