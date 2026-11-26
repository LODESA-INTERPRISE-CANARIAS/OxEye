/**
 * Navigation primitives: the vertical sidebar list (desktop/tablet) and the
 * bottom tab bar (phone). Both mark the current item with `aria-current`.
 */
import {Icon, type IconName} from './icons';

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: IconName;
}

export interface NavListProps<T extends string> {
  items: NavItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  label: string;
  idPrefix: string;
}

export function SidebarNav<T extends string>({
  items,
  active,
  onSelect,
  label,
  idPrefix,
}: NavListProps<T>) {
  return (
    <nav className="lx-sidenav" aria-label={label}>
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <button
              type="button"
              id={`${idPrefix}-${item.id}`}
              className="lx-sidenav__item"
              aria-current={item.id === active ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function TabBar<T extends string>({
  items,
  active,
  onSelect,
  label,
  idPrefix,
}: NavListProps<T>) {
  return (
    <nav className="lx-tabbar" aria-label={label}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          id={`${idPrefix}-${item.id}`}
          className="lx-tabbar__item"
          aria-current={item.id === active ? 'page' : undefined}
          onClick={() => onSelect(item.id)}
        >
          <span className="lx-tabbar__icon">
            <Icon name={item.icon} size={22} />
          </span>
          <span className="lx-tabbar__label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
