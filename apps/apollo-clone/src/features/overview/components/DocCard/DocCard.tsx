import { NavLink } from 'react-router';
import styles from './DocCard.module.css';

export interface DocCardProps {
  title: string;
  description: string;
  href: string;
}

export const DocCard: React.FC<DocCardProps> = ({ href, title, description }) => {
  return (
    <NavLink className={styles.root} to={href}>
      <strong className={styles.title}>{title}</strong>
      <span className={styles.description}>{description}</span>
    </NavLink>
  );
};
