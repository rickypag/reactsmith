import { Outlet } from 'react-router';
import { Sidebar } from '../../components/Sidebar';
import styles from './RootLayout.module.css';

export const RootLayout: React.FC = () => {
  return (
    <div className={styles.root}>
      <Sidebar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
};
