import styles from './SidebarSection.module.css';
import { SidebarLink } from '../SidebarLink';

export interface SidebarSectionProps {
  title: string;
  pages: { label: string; href: string }[];
}

export const SidebarSection: React.FC<SidebarSectionProps> = ({ title, pages }) => {
  return (
    <div className={styles.root}>
      <h2 className={styles.title}>{title}</h2>
      {pages.map((page) => <SidebarLink key={page.href} {...page} />)}
    </div>
  );
};
