/**
 * Airy rounded card with an optional header (title, eyebrow, help, actions).
 */
import React from 'react';

export interface CardProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  'title'
> {
  title?: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** Right side of the header: buttons, help, chips. */
  actions?: React.ReactNode;
  /** Heading level for the title (default h2). */
  level?: 2 | 3;
  as?: 'section' | 'article' | 'div';
  tone?: 'default' | 'accent' | 'notice';
  padded?: boolean;
}

export const Card: React.FC<CardProps> = ({
  title,
  eyebrow,
  actions,
  level = 2,
  as: Tag = 'section',
  tone = 'default',
  padded = true,
  className,
  children,
  ...rest
}) => {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <Tag
      className={[
        'lx-card',
        `lx-card--${tone}`,
        padded ? '' : 'lx-card--flush',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {(title || eyebrow || actions) && (
        <header className="lx-card__head">
          <div className="lx-card__titles">
            {eyebrow && <p className="lx-eyebrow">{eyebrow}</p>}
            {title && <Heading className="lx-card__title">{title}</Heading>}
          </div>
          {actions && <div className="lx-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
};
