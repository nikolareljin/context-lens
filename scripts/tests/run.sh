#!/usr/bin/env bash
# Run every scripts/tests/test_*.sh; exit non-zero when any test fails.
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failed=0; total=0
for t in "$dir"/test_*.sh; do
  echo "== $(basename "$t")"
  if bash "$t"; then :; else failed=$((failed + 1)); fi
  total=$((total + 1))
done
if [[ "$failed" -gt 0 ]]; then
  echo "script tests: $failed of $total files failed" >&2; exit 1
fi
echo "script tests: $total files passed"
