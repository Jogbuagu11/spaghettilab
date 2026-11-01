-- Scheduled jobs.
--
-- Deliberately NOT a migration: these need the service role key, and a secret
-- must never be committed. The key is read from Supabase Vault at call time.
--
-- Run once in the Supabase SQL editor after replacing YOUR-PROJECT-REF:
--
--   1. Store the key (Dashboard -> Project Settings -> Vault, or):
--        select vault.create_secret(
--          '<your service role key>', 'service_role_key', 'For pg_cron callbacks');
--
--   2. Execute this file.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Weekly standing orders. Runs every morning at 9am Pacific and charges any
-- subscription due that day. The function is idempotent, so an extra run is
-- harmless — it simply finds nothing due.
select cron.schedule(
  'run-subscriptions',
  '0 16 * * *',  -- 16:00 UTC = 9am PST / 8am PDT
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/run-subscriptions',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Review requests, hourly. The function only picks up orders completed at
-- least three hours ago, and email_log stops anyone being asked twice.
select cron.schedule(
  'send-review-requests',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-review-requests',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- To inspect or remove:
--   select jobname, schedule, active from cron.job;
--   select cron.unschedule('run-subscriptions');
--   select cron.unschedule('send-review-requests');
