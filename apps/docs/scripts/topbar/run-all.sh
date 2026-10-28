#!/usr/bin/env bash
# Runs every TopBar scenario and reports which passed. The TopBar is left in the final state of the last one.
cd "$(dirname "$0")"
passed=()
failed=()
for scenario in [0-9][0-9]-*.sh; do
  echo
  echo "━━━ $scenario"
  if bash "$scenario"; then passed+=("$scenario"); else failed+=("$scenario"); fi
done

echo
echo "${#passed[@]} passed, ${#failed[@]} failed"
for scenario in "${failed[@]}"; do echo "  ✖ $scenario"; done
[ ${#failed[@]} -eq 0 ]
