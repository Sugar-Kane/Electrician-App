#!/usr/bin/env bash
# Database tests for supervised AI actions, against a THROWAWAY local Postgres.
#
#   PSQL="psql -h localhost -U postgres" scripts/test-supervised-db.sh
#
# Creates the database volteira_supervised_test, applies a small stub of the
# schema plus the real task and supervised-action migrations, runs
# supabase/tests/supervised-actions.test.sql, then races many sessions at the
# same rows. Never point it at a Supabase project: it drops its database.
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL=${PSQL:-psql}
DB=volteira_supervised_test
q() { $PSQL -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

$PSQL -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
for file in \
  supabase/tests/supervised-actions-stub.sql \
  supabase/migrations/20261107030000_task_assistants.sql \
  supabase/migrations/20261107040000_task_assistant_chatgpt.sql \
  supabase/migrations/20261115000000_supervised_actions.sql; do
  q -f "$file" >/dev/null 2>&1 || { echo "not ok - $file did not apply"; q -f "$file"; exit 1; }
done
echo "ok - migrations apply"

out=$(q -f supabase/tests/supervised-actions.test.sql 2>&1) || { echo "$out" | grep -E "ok -|FAILED|ERROR"; exit 1; }
echo "$out" | grep -o "ok - .*"

OWNER=00000000-0000-0000-0000-00000000000a
ORG=10000000-0000-0000-0000-000000000001

# Twenty simultaneous approvals of one proposal: exactly one wins.
P=$(q -t -A -c "select proposal_id from public.create_supervised_proposal('$ORG', 'issue_refund', 'Refund \$180', 'race', 'chatgpt', null, 'ai', now() + interval '1 day', null, null, null, 18000)")
H=$(q -t -A -c "select content_hash from public.task_proposals where id = '$P'")
for _ in $(seq 20); do
  q -t -A -c "select code from public.decide_supervised_proposal_for('$OWNER', 'app', '$P', 'approve', '$H')" &
done > /tmp/volteira-race-approve.txt
wait
wins=$(grep -c '^ok$' /tmp/volteira-race-approve.txt || true)
[ "$wins" = 1 ] && echo "ok - 20 simultaneous approvals: one succeeds" || { echo "not ok - $wins approvals succeeded"; exit 1; }
audits=$(q -t -A -c "select count(*) from public.supervised_action_audit where proposal_id = '$P' and event = 'approved'")
[ "$audits" = 1 ] && echo "ok - and it is audited once" || { echo "not ok - $audits approval audits"; exit 1; }

# Ten workers claiming at once: the action runs once.
for _ in $(seq 10); do
  q -t -A -c "select count(*) from public.claim_supervised_actions(array['issue_refund'], 10, 60, '$P')" &
done > /tmp/volteira-race-claim.txt
wait
claims=$(paste -sd+ /tmp/volteira-race-claim.txt | bc)
[ "$claims" = 1 ] && echo "ok - 10 simultaneous claims: one worker runs it" || { echo "not ok - claimed $claims times"; exit 1; }

# The same webhook or retry arriving ten times at once: one event, one proposal.
for _ in $(seq 10); do
  q -t -A -c "select created from public.record_automation_event('$ORG', 'invoice.overdue', 'race-invoice:2026-11-01')" &
done > /tmp/volteira-race-event.txt
wait
created=$(grep -c '^t$' /tmp/volteira-race-event.txt || true)
[ "$created" = 1 ] && echo "ok - 10 simultaneous deliveries of one event: recorded once" || { echo "not ok - recorded $created times"; exit 1; }
for _ in $(seq 10); do
  q -t -A -c "select proposal_id from public.create_supervised_proposal('$ORG', 'send_customer_message', 'Reminder', 'race', 'event', null, 'system', now() + interval '1 day', null, null, null, null, null, null, 'invoice_overdue', '{}'::jsonb, '{}'::jsonb, null, 'race-dedupe')" &
done > /tmp/volteira-race-proposal.txt
wait
distinct=$(sort -u /tmp/volteira-race-proposal.txt | grep -c . || true)
rows=$(q -t -A -c "select count(*) from public.task_proposals where dedupe_key = 'race-dedupe'")
[ "$distinct" = 1 ] && [ "$rows" = 1 ] && echo "ok - 10 simultaneous proposals for one event: one proposal" || { echo "not ok - $rows rows, $distinct ids"; exit 1; }

echo "all supervised-action database tests passed"
