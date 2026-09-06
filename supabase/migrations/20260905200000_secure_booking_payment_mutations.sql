-- Payment-state mutations are server operations. They are reached after a
-- signature-verified Stripe webhook or after the server retrieves a Checkout
-- session with the secret key. The anonymous browser key may read its own
-- token-scoped booking view, but it must never be able to mark a booking paid,
-- attach a session, or expire a hold.

alter table public.booking_requests
  add column if not exists payment_notified_at timestamptz;

comment on column public.booking_requests.payment_notified_at is
  'Atomic claim for the customer and owner notifications sent after payment confirms the appointment.';

revoke all on function public.attach_public_booking_checkout(uuid, text) from public;
revoke execute on function public.attach_public_booking_checkout(uuid, text) from anon, authenticated;
grant execute on function public.attach_public_booking_checkout(uuid, text) to service_role;

revoke all on function public.confirm_public_booking_payment(uuid, text, text, integer, text) from public;
revoke execute on function public.confirm_public_booking_payment(uuid, text, text, integer, text) from anon, authenticated;
grant execute on function public.confirm_public_booking_payment(uuid, text, text, integer, text) to service_role;

revoke all on function public.expire_public_booking_checkout(uuid, text) from public;
revoke execute on function public.expire_public_booking_checkout(uuid, text) from anon, authenticated;
grant execute on function public.expire_public_booking_checkout(uuid, text) to service_role;

revoke all on function public.expire_public_booking_hold(uuid) from public;
revoke execute on function public.expire_public_booking_hold(uuid) from anon, authenticated;
grant execute on function public.expire_public_booking_hold(uuid) to service_role;
