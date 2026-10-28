import styles from './Sidebar.module.css';
import { HomeIcon, ShoppingCartIcon, TableIcon } from 'lucide-react';
import { NavItem } from '../NavItem';

export const Sidebar: React.FC = () => {
  return (
    <aside className={styles.root}>
      <div className={styles.brand}>
        <span className={styles.horizon}>Horizon</span>
        <span>Free</span>
      </div>
      <nav className={styles.pages}>
        <NavItem icon={HomeIcon} label='Dashboard' to='/' />
        <NavItem icon={ShoppingCartIcon} label='Marketplace' to='/marketplace' />
        <NavItem icon={TableIcon} label='Tables' to='/tables' />
      </nav>
    </aside>
  );
};
