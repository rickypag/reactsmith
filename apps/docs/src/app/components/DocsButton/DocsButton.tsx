import styles from './DocsButton.module.css';
import { ArrowRight } from 'lucide-react';

export const DocsButton: React.FC = () => {
  return <button className={styles.root}>Read the docs<ArrowRight size={16} /></button>;
};
