-- Default text-message templates per tenant.
--
-- public.message_templates has existed since the messaging foundation with
-- twelve trigger events and no rows, so nothing could ever fire. These are the
-- wording a business starts with; they are editable per tenant afterwards.
--
-- Every body ends with "Reply STOP to opt out." because that is what was filed
-- with the A2P campaign as the sample messages, and traffic that does not match
-- the registration is what gets a campaign pulled.
--
-- Placeholders are {{name}} and are substituted by the application. An unknown
-- placeholder renders as empty rather than as literal braces.

create or replace function private.default_message_templates()
returns table (trigger_event text, body text)
language sql
immutable
as $$
  values
    ('job_confirmed',
     'Hi {{customer_first_name}}, your appointment with {{business_name}} is confirmed for {{arrival_window}}. Reply STOP to opt out.'),
    ('job_reminder',
     'Reminder from {{business_name}}: your electrical appointment is {{arrival_window}}. Reply STOP to opt out.'),
    ('job_en_route',
     '{{business_name}}: your technician is on the way and should arrive within {{arrival_window}}. Reply STOP to opt out.'),
    ('job_arrived',
     '{{business_name}}: your technician has arrived. Reply STOP to opt out.'),
    ('job_completed',
     '{{business_name}}: the work at your property is complete. Thanks for choosing us. Reply STOP to opt out.'),
    ('job_rescheduled',
     '{{business_name}}: your appointment has been moved to {{arrival_window}}. Reply STOP to opt out.'),
    ('job_canceled',
     '{{business_name}}: your appointment has been canceled. Call {{business_phone}} to rebook. Reply STOP to opt out.'),
    ('job_awaiting_payment',
     '{{business_name}}: we are holding your appointment slot until payment is completed. Reply STOP to opt out.'),
    ('estimate_sent',
     '{{business_name}}: your estimate is ready. Reply with any questions. Reply STOP to opt out.'),
    ('invoice_sent',
     '{{business_name}}: your invoice is ready. Reply with any questions. Reply STOP to opt out.'),
    ('invoice_overdue',
     '{{business_name}}: a reminder that your invoice is past due. Call {{business_phone}} with any questions. Reply STOP to opt out.'),
    ('review_request',
     '{{business_name}}: thanks again for your business. If you have a moment, we would appreciate a review. Reply STOP to opt out.')
$$;

revoke all on function private.default_message_templates() from public, anon, authenticated;

insert into public.message_templates (organization_id, trigger_event, channel, body, is_active)
select organization.id, defaults.trigger_event, 'sms', defaults.body, true
from public.organizations as organization
cross join private.default_message_templates() as defaults
where organization.archived_at is null
on conflict (organization_id, trigger_event, channel) do nothing;

-- New tenants get the same set at signup, so a business is never left with a
-- messaging feature that silently does nothing.
create or replace function public.seed_message_templates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.message_templates (organization_id, trigger_event, channel, body, is_active)
  select new.id, defaults.trigger_event, 'sms', defaults.body, true
  from private.default_message_templates() as defaults
  on conflict (organization_id, trigger_event, channel) do nothing;

  return new;
end;
$$;

revoke all on function public.seed_message_templates() from public, anon, authenticated;

drop trigger if exists seed_message_templates on public.organizations;
create trigger seed_message_templates
after insert on public.organizations
for each row execute function public.seed_message_templates();
