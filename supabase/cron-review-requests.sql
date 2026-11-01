-- Optional: schedule the review-request sweep.
--
-- This is deliberately NOT a migration. It needs the service role key, and a
-- secret must never be committed to the repo — so the key is read from
-- Supabase Vault at call time instead of being written into SQL here.
--
-- Run once, in the Supabase SQL editor:
--
--   1. Store the key (Dashboard -> Project Settings -> Vault, or):
--        select vault.create_secret(
--          '<your service role key>', 'service_role_key', 'For pg_cron callbacks');
--
--   2. Set your project ref below, then execute this whole file.

create extension if not exists pg_cron  with schema extensions;
create extension if not exists pg_net   with schema extensions;

-- Replace with your project ref before running.
\set project_ref 'YOUR-PROJECT-REF'

select cron.schedule(
  'send-review-requests',
  '0 * * * *',  -- hourly; the function itself only picks orders 3+ hours old
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
--   select * from cron.job;
--   select cron.unschedule('send-review-requests');
