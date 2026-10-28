#!/usr/bin/env bash
# Wrong commands along the way must be refused without touching anything; the right ones then still work.
source "$(dirname "$0")/lib.sh"
reset_top_bar

rs_refused element remove "$H"                                                    # the root
rs_refused element insert span --into "$H" --position before --text "x"           # next to the root
rs_refused element insert div --into "$H" --text "x"                              # text in a layout element
rs element insert span --into "$H" --text "ReactSmith" --name brand
rs_refused element insert span --into "$H/span" --text "x"                        # into a text element
rs_refused element insert span --into "$H" --text "x" --name brand                # style name taken
rs_refused element insert div --into "$H" --gap 4                                 # layout without --name

rs element insert div --into "$H" --name actions --direction row --align center --gap 4
rs element insert a --into "$A" --text "GitHub" --href "$GITHUB"
rs_refused component insert DocsButton --app --into "$A"                          # not created yet
create_docs_button
rs_refused component create DocsButton --app --root button                        # already exists
rs_refused component insert DocsButton --feature user-profile --into "$A"         # wrong owner
rs component insert DocsButton --app --into "$A"

verify
