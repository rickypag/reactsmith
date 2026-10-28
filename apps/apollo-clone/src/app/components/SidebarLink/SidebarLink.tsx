import { NavLink } from 'react-router';
import styles from './SidebarLink.module.css';

export interface SidebarLinkProps {
  label: string;
  href: string;
}

export const SidebarLink: React.FC<SidebarLinkProps> = ({ label, href }) => {
  return <NavLink className={styles.root} to={href}>{label}</NavLink>;
};
