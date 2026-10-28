#!/usr/bin/env bash
# Left to right, each piece appended at the end: the natural order.
source "$(dirname "$0")/lib.sh"
reset_top_bar

rs element insert span --into "$H" --text "ReactSmith" --name brand
rs element insert div --into "$H" --name actions --direction row --align center --gap 4
rs element insert a --into "$A" --text "GitHub" --href "$GITHUB"
create_docs_button
rs component insert DocsButton --app --into "$A"

verify
