#!/usr/bin/env bash
# Shared helpers for the TopBar scenarios. Each scenario resets the TopBar to its state after
# "layout create", runs its commands in its own order, then verifies the same final result:
# "ReactSmith" on the left, the GitHub link and the DocsButton grouped on the right.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$APP_DIR"

# The ReactSmith CLI. Override it to test another build: RS="node path/to/cli.js" bash 01-in-order.sh
RS="${RS:-npx --no-install reactsmith}"

TOP_BAR=app/components/TopBar/TopBar.tsx # as in element ids: relative to src
TOP_BAR_FILE="src/$TOP_BAR"
TOP_BAR_CSS=src/app/components/TopBar/TopBar.module.css
DOCS_BUTTON_DIR=src/app/components/DocsButton
H="$TOP_BAR#header"   # the TopBar's root
A="$TOP_BAR#header/div" # the actions group on the right
GITHUB=https://github.com/rickypag/reactsmith
SCENARIO="$(basename "$0" .sh)"

# Runs a ReactSmith command, printing it first.
rs() {
  echo "\$ reactsmith $*"
  $RS "$@"
}

fail() {
  echo "✖ $SCENARIO: $*" >&2
  exit 1
}

# Runs a ReactSmith command that must be refused, and checks the TopBar did not change.
rs_refused() {
  local before
  before="$(cat "$TOP_BAR_FILE")"
  echo "\$ reactsmith $*   (must be refused)"
  if $RS "$@" >/dev/null 2>&1; then fail "this command should have been refused: reactsmith $*"; fi
  [ "$(cat "$TOP_BAR_FILE")" == "$before" ] || fail "a refused command changed $TOP_BAR_FILE"
}

# Runs a ReactSmith command with --dry-run, and checks nothing was written.
rs_dry() {
  local before
  before="$(cat "$TOP_BAR_FILE" "$TOP_BAR_CSS")"
  echo "\$ reactsmith $* --dry-run"
  $RS "$@" --dry-run >/dev/null
  [ "$(cat "$TOP_BAR_FILE" "$TOP_BAR_CSS")" == "$before" ] || fail "--dry-run changed the TopBar"
}

# The line of the first match of $1 in the TopBar file, for "file:line" targets.
line_of() {
  grep -n -m1 -- "$1" "$TOP_BAR_FILE" | cut -d: -f1
}

file_contains() {
  node -e 'const [file, text] = process.argv.slice(1); process.exit(require("fs").readFileSync(file, "utf8").includes(text) ? 0 : 1)' "$1" "$2"
}

# The TopBar as "layout create --topbar" generates it, and no DocsButton.
reset_top_bar() {
  rm -rf "$DOCS_BUTTON_DIR"
  cat >"$TOP_BAR_FILE" <<'EOF'
import styles from './TopBar.module.css';

export const TopBar: React.FC = () => {
  return <header className={styles.root} />;
};
EOF
  cat >"$TOP_BAR_CSS" <<'EOF'
.root {
  display: flex;
  flex-direction: row;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4);
  flex-shrink: 0;
  height: 3.5rem;
  border-bottom: 1px solid var(--color-border);
}
EOF
  echo "↺ $SCENARIO: TopBar reset"
}

# The same final result, whatever the order of the commands.
verify() {
  local expected
  expected="$(cat <<'EOF'
import styles from './TopBar.module.css';
import { DocsButton } from '../DocsButton';

export const TopBar: React.FC = () => {
  return (
    <header className={styles.root}>
      <span className={styles.brand}>ReactSmith</span>
      <div className={styles.actions}>
        <a href="https://github.com/rickypag/reactsmith">GitHub</a>
        <DocsButton />
      </div>
    </header>
  );
};
EOF
)"
  diff -u <(echo "$expected") "$TOP_BAR_FILE" || fail "TopBar.tsx differs from the expected result (see the diff above)"

  # The rules may be in any order, depending on which element was inserted first.
  file_contains "$TOP_BAR_CSS" $'.brand {\n}\n' || fail "TopBar.module.css has no empty .brand rule"
  file_contains "$TOP_BAR_CSS" $'.actions {\n  display: flex;\n  flex-direction: row;\n  gap: var(--space-4);\n  align-items: center;\n}\n' ||
    fail "TopBar.module.css has no .actions rule with the expected layout"

  local button
  button="$(cat <<'EOF'
import styles from './DocsButton.module.css';

export const DocsButton: React.FC = () => {
  return <button className={styles.root}>Read the docs</button>;
};
EOF
)"
  diff -u <(echo "$button") "$DOCS_BUTTON_DIR/DocsButton.tsx" || fail "DocsButton.tsx differs from the expected result"

  $RS check >/dev/null || { $RS check; fail "reactsmith check reports problems"; }
  npx --no-install tsc -p tsconfig.app.json --noEmit || fail "TypeScript reports errors"
  echo "✔ $SCENARIO passed"
}

# The DocsButton: just a button, with its text.
create_docs_button() {
  rs component create DocsButton --app --root button --text "Read the docs"
}
