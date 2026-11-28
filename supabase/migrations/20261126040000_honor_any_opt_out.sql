-- A customer's request to stop texts holds, however they made it (FCC
-- revocation rule, 47 CFR 64.1200(a)(10); compliance FED-002-005).
--
-- 1. Where the opt-out came from, kept apart from the opt-in's own source and
--    proof so recording one never erases the evidence of the other: the
--    customer's own words by text, Twilio's STOP list (error 21610), or staff
--    noting a request made by phone, in person or by email.
-- 2. Only the customer can turn texts back on (by texting START, recorded by
--    the service role). A signed-in user may record an opt-out but may not
--    clear it, back-date it, add an opt-in on top of it, or delete the row
--    that holds it.

alter table public.messaging_consent
  add column if not exists opt_out_source text,
  add column if not exists opt_out_proof text;

alter table public.messaging_consent drop constraint if exists messaging_consent_opt_out_source_check;
alter table public.messaging_consent
  add constraint messaging_consent_opt_out_source_check
  check (opt_out_source is null or opt_out_source in ('inbound_text', 'carrier', 'verbal', 'written', 'email', 'admin'));

comment on column public.messaging_consent.opt_out_source is
  'How the customer asked to stop: inbound_text (their own words or a STOP keyword), carrier (Twilio STOP list), verbal, written or email (recorded by staff), admin.';
comment on column public.messaging_consent.opt_out_proof is
  'The customer''s words, or who recorded the request and how it was made.';

create or replace function private.guard_consent_opt_out()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Signed-in users only; the service role (inbound texts, START) is trusted.
  if coalesce(pg_catalog.current_setting('role', true), '') not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.opted_out_at is not null then
      raise exception 'This customer asked not to be texted. That record cannot be removed; only the customer can turn texts back on, by texting START.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.opted_out_at is not null then
    if new.opted_out_at is null
       or new.opted_out_at < old.opted_out_at
       or new.opted_in_at is distinct from old.opted_in_at then
      raise exception 'This customer asked not to be texted. Only they can turn texts back on, by texting START.'
        using errcode = '42501';
    end if;
  end if;

  -- An opt-in may not be written later than an opt-out in the same change.
  if new.opted_out_at is not null and new.opted_in_at is not null and new.opted_in_at > new.opted_out_at
     and (tg_op = 'INSERT' or new.opted_in_at is distinct from old.opted_in_at) then
    raise exception 'This customer asked not to be texted. Only they can turn texts back on, by texting START.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_consent_opt_out() from public, anon, authenticated;

drop trigger if exists guard_consent_opt_out on public.messaging_consent;
create trigger guard_consent_opt_out
  before insert or update or delete on public.messaging_consent
  for each row execute function private.guard_consent_opt_out();
