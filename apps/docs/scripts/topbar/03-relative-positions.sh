#!/usr/bin/env bash
# Placed relative to siblings: --position before and after an element instead of into its parent.
source "$(dirname "$0")/lib.sh"
reset_top_bar

rs element insert div --into "$H" --name actions --direction row --align center --gap 4
rs element insert span --into "$A" --position before --text "ReactSmith" --name brand
create_docs_button
rs component insert DocsButton --app --into "$A"
rs element insert a --into "$A/DocsButton" --position before --text "GitHub" --href "$GITHUB"

verify
