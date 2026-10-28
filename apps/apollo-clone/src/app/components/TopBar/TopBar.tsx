import styles from './TopBar.module.css';
import { NavLink } from 'react-router';
import { NavMenu } from '../NavMenu';
import { SearchIcon, MoonIcon } from 'lucide-react';

export const TopBar: React.FC = () => {
  return (
    <header className={styles.root}>
      <div className={styles.start}>
        <NavLink className={styles.brand} to='/'>
          <span className={styles.logo}>APOLLO</span>
          <span className={styles.badge}>DOCS</span>
        </NavLink>
        <nav className={styles.menus}>
          <NavMenu label='Products' />
          <NavMenu label='Open source' />
          <NavLink className={styles.link} to='/resources'>Resources</NavLink>
        </nav>
      </div>
      <div className={styles.end}>
        <button className={styles.search}><SearchIcon size={18} />Search Apollo content (Cmd+K or /)</button>
        <button className={styles.theme}>
          <MoonIcon size={18} />
        </button>
        <button className={styles.signIn}>Sign In</button>
      </div>
    </header>
  );
};
