#!/usr/bin/env bash
# Targets given as "file:line", as an agent or a dev reading the code would, instead of ids.
# Lines move after every insert, so each one is looked up right before its command.
source "$(dirname "$0")/lib.sh"
reset_top_bar

rs element insert span --into "$TOP_BAR_FILE:$(line_of '<header')" --text "ReactSmith" --name brand
rs element insert div --into "$TOP_BAR_FILE:$(line_of '<header')" --name actions --direction row --align center --gap 4
create_docs_button
rs component insert DocsButton --app --into "$TOP_BAR_FILE:$(line_of 'styles.actions')"
rs element insert a --into "$TOP_BAR_FILE:$(line_of '<DocsButton')" --position before --text "GitHub" --href "$GITHUB"

# The id of what a line points to, as "reactsmith id" reports it.
[ "$($RS id "$TOP_BAR_FILE:$(line_of '<DocsButton')" --json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).data.id)')" == "$A/DocsButton" ] ||
  fail "reactsmith id does not give $A/DocsButton"

verify
