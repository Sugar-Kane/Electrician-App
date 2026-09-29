-- New businesses could not sign up.
--
-- `create_owner_workspace` inserts the business, and three triggers then set it
-- up. Two of them fail, and either one takes the whole signup down with it —
-- "We couldn't create the business workspace", every time. The one business in
-- production was created before both, so nobody had seen it.
--
-- 1. The text messages. 20260825160000_customer_language widened the unique key
--    on `message_templates` to add `language`, and the trigger that seeds a
--    new business's messages still named the old three-column key in its
--    ON CONFLICT. Postgres refuses an ON CONFLICT that matches no unique index.
--
-- 2. The document folders, behind it. That trigger runs as the person signing
--    up, and `document_folders` only admits members of the business — but
--    `create_owner_workspace` makes them the owner a statement *after* the
--    business exists, so at the moment the folders are written they are not a
--    member of anything. Row-level security refuses them.
--
-- Messages first.
--
-- Repairing the key alone would have let a new business in with the wrong
-- messages. The defaults here were the first draft from 20260807153000, and
-- they never carried the links: a new business would have texted "we are
-- holding your appointment slot until payment is completed" with no way to
-- pay, and an invoice notice with no invoice in it. And no Spanish at all —
-- 20260825161000 backfilled Spanish only for businesses that already existed.
--
-- So the defaults become the set the live business actually sends, word for
-- word, in both languages, and a new business starts with all of it. They stay
-- editable per business afterwards, as before.
--
-- STOP stays STOP in Spanish, as in 20260825161000: it is the carrier's opt-out
-- keyword, and a translated one would not opt anybody out.

-- Dropped first: the columns change, and `create or replace` cannot change a
-- function's columns. Only the trigger function below reads it, and that is
-- replaced here too.
drop function if exists private.default_message_templates();

create function private.default_message_templates()
returns table (trigger_event text, language text, body text)
language sql
immutable
set search_path = ''
as $$
  values
    ('estimate_sent', 'en',
     '{{business_name}}: your estimate is ready. {{estimate_link}} Valid until {{expires_at}}.'),
    ('invoice_overdue', 'en',
     'Invoice #{{invoice_number}} ({{balance_due}}) is past due. Pay here: {{invoice_link}} Questions? Call {{business_phone}}.'),
    ('invoice_sent', 'en',
     '{{business_name}}: invoice #{{invoice_number}} for {{invoice_total}} is ready. {{invoice_link}}'),
    ('job_arrived', 'en',
     '{{technician_name}} has arrived for job #{{job_number}}.'),
    ('job_awaiting_payment', 'en',
     'Hi {{customer_first_name}}, {{business_name}} here. To lock in your appointment, the {{diagnostic_fee}} diagnostic fee is due: {{payment_link}} Reply STOP to opt out.'),
    ('job_canceled', 'en',
     'Job #{{job_number}} with {{business_name}} has been canceled. Questions? Call {{business_phone}}.'),
    ('job_completed', 'en',
     'Work is complete. Your invoice from {{business_name}}: {{invoice_link}}'),
    ('job_confirmed', 'en',
     'You''re booked with {{business_name}}. Job #{{job_number}}, arriving {{arrival_window}}. Free reschedule up to {{reschedule_hours}}h before. Reply STOP to opt out.'),
    ('job_en_route', 'en',
     '{{technician_name}} from {{business_name}} is on the way, ETA {{eta}}.'),
    ('job_reminder', 'en',
     'Reminder: {{business_name}} is scheduled for {{arrival_window}}. Reply R to reschedule or C to cancel.'),
    ('job_rescheduled', 'en',
     'Your {{business_name}} appointment moved to {{arrival_window}}. Job #{{job_number}}.'),
    ('review_request', 'en',
     'Thanks for choosing {{business_name}}. A quick review helps a lot: {{review_link}} Reply STOP to opt out.'),

    ('estimate_sent', 'es',
     '{{business_name}}: su presupuesto está listo. {{estimate_link}} Válido hasta {{expires_at}}.'),
    ('invoice_overdue', 'es',
     'La factura #{{invoice_number}} ({{balance_due}}) está vencida. Pague aquí: {{invoice_link}} ¿Preguntas? Llame al {{business_phone}}.'),
    ('invoice_sent', 'es',
     '{{business_name}}: la factura #{{invoice_number}} por {{invoice_total}} está lista. {{invoice_link}}'),
    ('job_arrived', 'es',
     '{{technician_name}} ha llegado para el trabajo #{{job_number}}.'),
    ('job_awaiting_payment', 'es',
     'Hola {{customer_first_name}}, le habla {{business_name}}. Para confirmar su cita, la tarifa de diagnóstico de {{diagnostic_fee}} debe pagarse: {{payment_link}} Responda STOP para no recibir más mensajes.'),
    ('job_canceled', 'es',
     'El trabajo #{{job_number}} con {{business_name}} ha sido cancelado. ¿Preguntas? Llame al {{business_phone}}.'),
    ('job_completed', 'es',
     'El trabajo está terminado. Su factura de {{business_name}}: {{invoice_link}}'),
    ('job_confirmed', 'es',
     'Su cita con {{business_name}} está confirmada. Trabajo #{{job_number}}, llegada {{arrival_window}}. Puede reprogramar sin costo hasta {{reschedule_hours}}h antes. Responda STOP para no recibir más mensajes.'),
    ('job_en_route', 'es',
     '{{technician_name}} de {{business_name}} va en camino, hora estimada {{eta}}.'),
    ('job_reminder', 'es',
     'Recordatorio: {{business_name}} tiene una cita programada para {{arrival_window}}. Responda R para reprogramar o C para cancelar.'),
    ('job_rescheduled', 'es',
     'Su cita con {{business_name}} se movió a {{arrival_window}}. Trabajo #{{job_number}}.'),
    ('review_request', 'es',
     'Gracias por elegir {{business_name}}. Una reseña rápida ayuda mucho: {{review_link}} Responda STOP para no recibir más mensajes.')
$$;

revoke all on function private.default_message_templates() from public, anon, authenticated;

-- New tenants get the whole set at signup, so a business is never left with a
-- messaging feature that silently does nothing.
create or replace function public.seed_message_templates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.message_templates (organization_id, trigger_event, channel, language, body, is_active)
  select new.id, defaults.trigger_event, 'sms', defaults.language, defaults.body, true
  from private.default_message_templates() as defaults
  -- Every column of the key. Since 20260825160000 that includes the language,
  -- and naming fewer is the ON CONFLICT Postgres refused.
  on conflict (organization_id, trigger_event, channel, language) do nothing;

  return new;
end;
$$;

revoke all on function public.seed_message_templates() from public, anon, authenticated;

/*
 * Then the folders.
 *
 * `security definer`, as its two siblings on the same insert already are —
 * `seed_message_templates` and `create_tenant_legal_page` — and for the same
 * reason: it sets up a business that its owner does not belong to yet. It does
 * nothing with that but lay out the standard tree for the row just inserted,
 * whose id comes from `new` and never from the caller, and the folder writes
 * beneath it run with its rights, so nothing else needs to change.
 *
 * Adding a job still runs as the person adding it, and still has to be a
 * member to write a folder; that path never had this problem.
 */
create or replace function private.seed_organization_documents_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_organization_document_tree(new.id);
  return new;
end;
$$;

revoke all on function private.seed_organization_documents_on_insert() from public, anon, authenticated;
