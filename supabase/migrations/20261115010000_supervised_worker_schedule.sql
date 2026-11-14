-- Phase 2: run the supervised-action executor every five minutes.
--
-- pg_cron calls /api/operations/worker with a token kept in Vault, as the old
-- task worker did. The token is generated here, in the database, and never
-- shown; the deployment's VOLTEIRA_SUPERVISED_WORKER_TOKEN is set from it.
-- The route does nothing unless VOLTEIRA_PHASE2_WORKER_ENABLED is on, and
-- runs only the action types in VOLTEIRA_PHASE2_EXECUTE.
--
-- To stop it: select cron.unschedule('volteira-supervised-worker');

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'supervised_worker_token') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'supervised_worker_token',
      'Protects /api/operations/worker. Generated in the database; never shown.'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'supervised_worker_url') then
    perform vault.create_secret(
      'https://www.volteira.com/api/operations/worker',
      'supervised_worker_url',
      'Where pg_cron calls the supervised-action worker.'
    );
  end if;
end;
$$;

select cron.schedule(
  'volteira-supervised-worker',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'supervised_worker_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-supervised-worker-token', (select decrypted_secret from vault.decrypted_secrets where name = 'supervised_worker_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);
