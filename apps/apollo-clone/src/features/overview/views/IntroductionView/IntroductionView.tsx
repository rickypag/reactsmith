import styles from './IntroductionView.module.css';
import { NavLink } from 'react-router';
import { CORE_FEATURES, RECOMMENDED_DOCS } from '../../constants';
import { FeatureItem } from '../../components/FeatureItem';
import { DocCard } from '../../components/DocCard';

export const IntroductionView: React.FC = () => {
  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Introduction to Apollo Client</h1>
      <p className={styles.lead}>Apollo Client is a state management library for JavaScript: it manages local and remote data with GraphQL.</p>
      <p className={styles.intro}>Use it to fetch, cache and modify application data, while your UI updates automatically. It has built-in support for React, and community integrations for other view layers.</p>
      <NavLink className={styles.cta} to='/get-started'>Get started!</NavLink>
      <hr className={styles.divider} />
      <h2 className={styles.featuresTitle}>Core features</h2>
      <div className={styles.features}>
        {CORE_FEATURES.map((feature) => <FeatureItem key={feature.title} {...feature} />)}
      </div>
      <h2 className={styles.docsTitle}>Recommended docs</h2>
      <div className={styles.docs}>
        {RECOMMENDED_DOCS.map((doc) => <DocCard key={doc.href} {...doc} />)}
      </div>
      <h2 className={styles.communityTitle}>Community integrations</h2>
      <p className={styles.integrations}>These docs focus on React, but Apollo Client also works with Angular, Vue, Svelte, Solid.js and Ember, and has native clients for iOS and Android.</p>
    </div>
  );
};
