import { NavLink } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import styles from './NavItem.module.css';

export interface NavItemProps {
  icon: LucideIcon;
  label: string;
  to: string;
  selected?: boolean;
}

export const NavItem: React.FC<NavItemProps> = ({ to, icon: Icon, label, selected }) => {
  return (
    <NavLink className={styles.root} to={to} data-selected={selected}>
      <Icon className={styles.icon} />
      <span className={styles.label}>{label}</span>
    </NavLink>
  );
};
