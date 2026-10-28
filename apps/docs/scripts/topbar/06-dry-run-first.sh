#!/usr/bin/env bash
# Every step previewed with --dry-run first, as a cautious dev or agent would: the preview must write nothing.
source "$(dirname "$0")/lib.sh"
reset_top_bar

rs_dry element insert span --into "$H" --text "ReactSmith" --name brand
rs element insert span --into "$H" --text "ReactSmith" --name brand

rs_dry element insert div --into "$H" --name actions --direction row --align center --gap 4
rs element insert div --into "$H" --name actions --direction row --align center --gap 4

rs_dry element insert a --into "$A" --text "GitHub" --href "$GITHUB"
rs element insert a --into "$A" --text "GitHub" --href "$GITHUB"

echo "\$ reactsmith component create DocsButton ... --dry-run"
$RS component create DocsButton --app --root button --text "Read the docs" --dry-run >/dev/null
[ ! -e "$DOCS_BUTTON_DIR" ] || fail "--dry-run created the DocsButton"
create_docs_button

rs_dry component insert DocsButton --app --into "$A"
rs component insert DocsButton --app --into "$A"

verify
