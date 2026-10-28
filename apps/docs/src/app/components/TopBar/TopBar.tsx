import styles from './TopBar.module.css';
import { Brand } from '../Brand';
import { GitGraph } from 'lucide-react';
import { DocsButton } from '../DocsButton';

export const TopBar: React.FC = () => {
  return (
    <header className={styles.root}>
      <Brand />
      <nav className={styles.links}>
        <a href="#features">Features</a>
        <a href="#structure">Structure</a>
        <a className={styles.github} href="https://github.com/rickypag/reactsmith"><GitGraph size={16} />GitHub</a>
        <DocsButton />
      </nav>
    </header>
  );
};
