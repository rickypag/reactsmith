#!/usr/bin/env bash
# Mistakes undone: the link and the button first go straight into the header, are removed
# (the button's import goes with it), then are put in the actions group.
source "$(dirname "$0")/lib.sh"
reset_top_bar

rs element insert a --into "$H" --text "GitHub" --href "$GITHUB"
create_docs_button
rs component insert DocsButton --app --into "$H"
rs element remove "$H/a"
rs component remove "$H/DocsButton"
file_contains "$TOP_BAR_FILE" "DocsButton" && fail "removing the last DocsButton should remove its import"

rs element insert span --into "$H" --text "ReactSmith" --name brand
rs element insert div --into "$H" --name actions --direction row --align center --gap 4
rs element insert a --into "$A" --text "GitHub" --href "$GITHUB"
rs component insert DocsButton --app --into "$A"

verify
