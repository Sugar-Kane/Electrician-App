-- ---------------------------------------------------------------------------
-- Recording that the customer agreed to the fee.
--
-- The booking page has always had a box to tick and has never written down that
-- it was ticked: the value went into the consent column for being contacted,
-- which is a different agreement about a different thing.
--
-- A function rather than an update from the page, because the page runs as the
-- anonymous key and has no business being able to write to booking_requests.
-- It knows one unguessable token — the one it was just handed — and this lets
-- it do exactly one thing with it.
-- ---------------------------------------------------------------------------

create or replace function public.accept_booking_fee(p_booking_token uuid, p_via text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  request public.booking_requests%rowtype;
begin
  if p_via is null or p_via not in ('web', 'sms', 'voice') then
    return false;
  end if;

  -- Only the first yes. A refreshed page or a retried request must not write a
  -- second agreement, and the time that matters is when they first said it.
  update public.booking_requests
  set fee_accepted_at = pg_catalog.now(),
      fee_accepted_via = p_via
  where public_token = p_booking_token
    and fee_accepted_at is null
  returning * into request;

  if request.id is null then
    -- Either no such booking, or it was already agreed to. Both are "nothing
    -- more to do", and telling the caller which would be telling an anonymous
    -- caller whether a token exists.
    return true;
  end if;

  insert into public.activity_events (
    organization_id, event_type, label, booking_request_id, metadata
  ) values (
    request.organization_id,
    'booking.fee_accepted',
    'Agreed to the diagnostic fee',
    request.id,
    pg_catalog.jsonb_build_object('amount_cents', request.deposit_cents, 'via', p_via)
  );

  return true;
end;
$fn$;

comment on function public.accept_booking_fee(uuid, text) is
  'Records the customer agreeing to the diagnostic fee, once, against an unguessable booking token.';
