import { Outlet } from 'react-router';
import { TopBar } from '../../components/TopBar';
import { Sidebar } from '../../components/Sidebar';
import styles from './RootLayout.module.css';

export const RootLayout: React.FC = () => {
  return (
    <div className={styles.root}>
      <TopBar />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};
