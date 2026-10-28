#!/usr/bin/env bash
# Right to left: the component first, then each piece prepended with --position first.
source "$(dirname "$0")/lib.sh"
reset_top_bar

create_docs_button
rs element insert div --into "$H" --name actions --direction row --align center --gap 4
rs component insert DocsButton --app --into "$A"
rs element insert a --into "$A" --position first --text "GitHub" --href "$GITHUB"
rs element insert span --into "$H" --position first --text "ReactSmith" --name brand

verify
