import styles from './NavMenu.module.css';
import { ChevronDownIcon } from 'lucide-react';

export interface NavMenuProps {
  label: string;
}

export const NavMenu: React.FC<NavMenuProps> = ({ label }) => {
  return <button className={styles.root}>{label}<ChevronDownIcon size={16} /></button>;
};
