#!/usr/bin/env bash
# The TopBar built only with commands:
#   left:  the Brand component, the anvil icon then "ReactSmith"
#   right: links "Features", "Structure", "GitHub" (with a graph icon on its left),
#          then the DocsButton "Read the docs" with an arrow icon at its end
# Needs lucide-react installed and recorded in the config ("icons": { "library": "lucide-react" }).
source "$(dirname "$0")/lib.sh"
reset_top_bar
rm -rf src/app/components/Brand

BRAND=app/components/Brand/Brand.tsx
BUTTON=app/components/DocsButton/DocsButton.tsx
NAV="$H/nav"

# Left: the brand, an icon and the name side by side.
rs component create Brand --app --direction row --align center --gap 2
rs icon insert anvil --into "$BRAND#div" --size 20
rs element insert span --into "$BRAND#div" --text "ReactSmith" --name name
rs component insert Brand --app --into "$H"

# Right: the navigation, a row of links and the button.
rs element insert nav --into "$H" --name links --direction row --align center --gap 4
rs element insert a --into "$NAV" --text "Features" --href "#features"
rs element insert a --into "$NAV" --text "Structure" --href "#structure"
rs element insert a --into "$NAV" --text "GitHub" --href "$GITHUB"
rs icon insert git-graph --into "$NAV/a[3]" --position first --size 16
rs style update "$NAV/a[3]" --name github --css "display: inline-flex; align-items: center; gap: 6px"

# The button: just a button, with its arrow at the end.
rs component create DocsButton --app --root button --text "Read the docs"
rs icon insert arrow-right --into "$BUTTON#button" --size 16
rs style update "$BUTTON#button" --css "display: inline-flex; align-items: center; gap: 6px"
rs component insert DocsButton --app --into "$NAV"

echo
for file in "$TOP_BAR_FILE" "src/$BRAND" "src/$BUTTON"; do
  echo "━━━ $file"
  cat "$file"
done
$RS check >/dev/null || { $RS check; fail "reactsmith check reports problems"; }
npx --no-install tsc -p tsconfig.app.json --noEmit || fail "TypeScript reports errors"
echo "✔ $SCENARIO passed"
