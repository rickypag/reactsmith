import styles from './Brand.module.css';
import { Anvil } from 'lucide-react';

export const Brand: React.FC = () => {
  return (
    <div className={styles.root}>
      <Anvil size={20} />
      <span className={styles.name}>ReactSmith</span>
    </div>
  );
};
