import styles from './Sidebar.module.css';
import { NAVIGATION } from '../../constants';
import { SidebarSection } from '../SidebarSection';

export const Sidebar: React.FC = () => {
  return (
    <aside className={styles.root}>
      {NAVIGATION.map((section) => <SidebarSection key={section.title} {...section} />)}
    </aside>
  );
};
