#!/usr/bin/env sh

set -eu

DIFF_CMD="${PRECOMMIT_DIFF_CMD:-git diff --cached -U0 --no-color}"
USER_CONFIRM_TOKENS="${PRECOMMIT_USER_CONFIRM_TOKENS:-getUserConfirmation|get_user_confirmation|user confirmation|user confirmed|confirmed by user|requires user confirmation|awaiting user confirmation|awaiting user|user-approved|user approved|user approval}"
LAST_LINK_TOKENS="${PRECOMMIT_LAST_LINK_TOKENS:-hash|version|sha|sha1|sha256|artifact|artifact-id|run-id|build-id|trace|trace_id|log|screenshot|url|link|banner|checksum|provenance|running output|runtime output|verify output}"
PERF_SIZE_TOKENS="${PRECOMMIT_PERF_SIZE_TOKENS:-size|bundle|framems|frame ms|frame|latency|throughput|p95|p99|qps|rps|fps|ms|sec|s|mb|gb|kb|bytes|memory|cpu|heap|rss|load|build time|duration}"
BLUNT_FORCE_WORDS="${PRECOMMIT_BLUNT_FORCE_WORDS:-retry|backoff|scale|multiplier|factor|timeout|delay|sleep|buffer|pool|batch|window|threshold|limit|max|min}"
ITER_COUNT_TOKENS="${PRECOMMIT_ITER_COUNT_TOKENS:-iter|iterate|iteration|itercount|retrycount|retry|retries|attempt|attempts}"
ITER_COUNT_LIMIT="${PRECOMMIT_ITER_COUNT_LIMIT:-10}"
SUSPICIOUS_NUMBER_LIMIT="${PRECOMMIT_SUSPICIOUS_NUMBER_LIMIT:-999}"
STALENESS_TOKENS="${PRECOMMIT_STALE_TOKENS:-stale|stale-code|stale code|cached|cache|outdated|old build|old output}"
STALE_CLEAR_TOKENS="${PRECOMMIT_STALE_CLEAR_TOKENS:-kill-stale|clear cache|cache clear|cache_bust|cache-bust|hash|version|banner|hashes|sha|checksum|artifact|running output|runtime output}"
FLAG_TOKENS="${PRECOMMIT_FLAG_TOKENS:-flag|enabled|toggle|feature|todo}"

has_match() {
  text="$1"
  pattern="$2"
  printf "%s" "$text" | grep -iqE "$pattern"
}

has_large_number() {
  text="$1"
  limit="$2"

  for n in $(printf "%s" "$text" | tr -c '0-9' ' '); do
    [ -z "$n" ] && continue
    if [ "$n" -ge "$limit" ] 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

emit() {
  file="$1"
  line_no="$2"
  rule="$3"
  detail="$4"
  action="$5"
  VIOLATIONS=$((VIOLATIONS + 1))
  printf "[%d] %s:%s | %s\n    %s\n    -> %s\n\n" "$VIOLATIONS" "$file" "$line_no" "$rule" "$detail" "$action" >&2
}

DIFF_OUTPUT=$($DIFF_CMD)
if [ -z "$DIFF_OUTPUT" ]; then
  echo "[ok] No staged diff found. Happy-path guard skipped."
  exit 0
fi

tmp_diff=$(mktemp)
trap 'rm -f "$tmp_diff"' EXIT
printf '%s\n' "$DIFF_OUTPUT" > "$tmp_diff"

VIOLATIONS=0
current_file=""
hunk_line=-1

while IFS= read -r raw_line; do
  case "$raw_line" in
    diff\ --git\ *)
      ;;
    ---\ a/*)
      ;;
    +++\ b/*)
      current_file="${raw_line#+++ b/}"
      ;;
    @@*)
      hunk_line=$(printf "%s" "$raw_line" | sed -n 's/^@@ -[0-9][0-9]*,\?[0-9][0-9]* \+\([0-9][0-9]*\).*/\1/p')
      if [ -z "$hunk_line" ]; then
        hunk_line=$(printf "%s" "$raw_line" | sed -n 's/^@@ -[0-9][0-9]* \+\([0-9][0-9]*\).*/\1/p')
      fi
      ;;
    +*)
      if [ -z "$current_file" ] || [ -z "$hunk_line" ] || [ "$hunk_line" -lt 0 ]; then
        continue
      fi

      line_text="${raw_line#\+}"
      line_no=$hunk_line
      hunk_line=$((hunk_line + 1))

      line_lower=$(printf "%s" "$line_text" | tr '[:upper:]' '[:lower:]')
      confirmed=0
      has_match "$line_lower" "$USER_CONFIRM_TOKENS" && confirmed=1

      if has_match "$line_lower" "✅|\\bdone\\b|\\bfixed\\b|\\bresolved\\b|\\bpass(ing|ed)?\\b|\\bcompleted\\b|\\bworks\\b" && [ "$confirmed" -eq 0 ]; then
        emit "$current_file" "$line_no" "Rule 1: user's eyes" "User-facing claim detected without explicit confirmation token." "Add getUserConfirmation or user-confirmed approval in staged diff."
      fi

      if has_match "$line_lower" "telemetry|\\bmetric\\b|\\bstatus\\s*[:=]\s*ok\\b|\\bpassed\\b|\\b200\\b|\\bbuild ok\\b" && ! has_match "$line_lower" "$LAST_LINK_TOKENS"; then
        emit "$current_file" "$line_no" "Rule 3: telemetry ≠ truth" "Success marker appears telemetry-only with no last-link outcome evidence." "Add artifact/hash/version/trace/log links or explicit runtime evidence."
      fi

      if has_match "$line_lower" "$BLUNT_FORCE_WORDS" && has_large_number "$line_lower" "$SUSPICIOUS_NUMBER_LIMIT" && [ "$confirmed" -eq 0 ]; then
        emit "$current_file" "$line_no" "Rule 5: root-cause" "Large numeric assignment/multiplier appears without root-cause context." "Prefer root-cause fix; attach measurement rationale if numeric clamp is required."
      fi

      if has_match "$line_lower" "$ITER_COUNT_TOKENS" && has_large_number "$line_lower" "$ITER_COUNT_LIMIT" && [ "$confirmed" -eq 0 ]; then
        emit "$current_file" "$line_no" "Rule 7: don't grind" "Iteration/retry threshold appears high without confirmed win signal." "Bound loops with user confirmation and observed exit condition."
      fi

      if has_match "$line_lower" "\\b(build|test|lint|bundle|deploy|pack)\\b" && has_match "$line_lower" "\\bpass(ed)?\\b|\\bok\\b|\\bsucceeded\\b|\\bsuccess(ful|fully)?\\b" && ! has_match "$line_lower" "$PERF_SIZE_TOKENS"; then
        emit "$current_file" "$line_no" "Rule 6: size/perf/robustness" "Build/test claim has no size/frameMs/perf evidence." "Append artifact size + frameMs/latency + stability metric evidence."
      fi

      if has_match "$line_lower" "$STALENESS_TOKENS" && has_match "$line_lower" "\\bfix\\b|\\bfixed\\b|\\bvalidated\\b|\\bverified\\b|\\btested\\b|\\bbuild\\b" && ! has_match "$line_lower" "$STALE_CLEAR_TOKENS" && [ "$confirmed" -eq 0 ]; then
        emit "$current_file" "$line_no" "Rule 2 / stale-code risk" "Stale/freshness claim lacks cache-kill/hash/version/banner tokens." "Call kill-stale/clear cache path and include version/hash from runtime output."
      fi

      if has_match "$line_lower" "${FLAG_TOKENS}.*\\b(false|off|disable)\\b|\\b(false|off|disable)\\b.*${FLAG_TOKENS}|TODO" && [ "$confirmed" -eq 0 ]; then
        emit "$current_file" "$line_no" "Pitfall: motion without result" "Feature flag/default-disabled path may be shipping as final state." "Do not mark final pass on TODO or false flags; add confirmation and rollout evidence."
      fi

      if has_match "$line_lower" "\\*=[[:space:]]*[0-9]{2,}|/[[:space:]]*[0-9]{2,}|\\^[0-9]{2,}" && has_match "$line_lower" "$BLUNT_FORCE_WORDS" && [ "$confirmed" -eq 0 ]; then
        emit "$current_file" "$line_no" "Rule 5: root-cause" "Scale operator with high numeric literal appears." "Document why this scaling is required and expected effect from telemetry evidence."
      fi
      ;;
    *)
      ;;
  esac
done < "$tmp_diff"

if [ "$VIOLATIONS" -ne 0 ]; then
  echo "[fail] Happy-path guard blocked commit. Review findings above." >&2
  exit 1
fi

echo "[ok] Happy-path guard passed on staged diff."
exit 0
