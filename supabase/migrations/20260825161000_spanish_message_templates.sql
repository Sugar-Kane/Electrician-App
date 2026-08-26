-- The Spanish body for every trigger a business already has.
--
-- Split from the schema migration on purpose, and this ordering is a
-- correctness requirement rather than tidiness.
--
-- Until the release that reads templates by language is live, the code fetches
-- a template with `.maybeSingle()` on (organization, trigger, channel). A
-- second row under that filter is not "an extra option" — it is an ambiguous
-- lookup, and the send fails. So this file is applied only once the
-- language-aware read is deployed.
--
-- Seeded from the triggers that exist rather than from a fixed list, so a
-- business that customised or removed one does not get a stray row back.
--
-- STOP stays STOP, and R and C stay R and C. STOP is a carrier keyword —
-- Twilio's 21610 is the carrier's own opt-out list — so "responda PARE" would
-- hand a Spanish speaker a word that does not actually opt them out, which is
-- a compliance failure dressed up as a translation.

insert into public.message_templates (organization_id, trigger_event, channel, body, language, is_active)
select t.organization_id, t.trigger_event, t.channel, s.body, 'es', t.is_active
from public.message_templates t
join (values
  ('estimate_sent', '{{business_name}}: su presupuesto está listo. {{estimate_link}} Válido hasta {{expires_at}}.'),
  ('invoice_overdue', 'La factura #{{invoice_number}} ({{balance_due}}) está vencida. Pague aquí: {{invoice_link}} ¿Preguntas? Llame al {{business_phone}}.'),
  ('invoice_sent', '{{business_name}}: la factura #{{invoice_number}} por {{invoice_total}} está lista. {{invoice_link}}'),
  ('job_arrived', '{{technician_name}} ha llegado para el trabajo #{{job_number}}.'),
  ('job_awaiting_payment', 'Hola {{customer_first_name}}, le habla {{business_name}}. Para confirmar su cita, la tarifa de diagnóstico de {{diagnostic_fee}} debe pagarse: {{payment_link}} Responda STOP para no recibir más mensajes.'),
  ('job_canceled', 'El trabajo #{{job_number}} con {{business_name}} ha sido cancelado. ¿Preguntas? Llame al {{business_phone}}.'),
  ('job_completed', 'El trabajo está terminado. Su factura de {{business_name}}: {{invoice_link}}'),
  ('job_confirmed', 'Su cita con {{business_name}} está confirmada. Trabajo #{{job_number}}, llegada {{arrival_window}}. Puede reprogramar sin costo hasta {{reschedule_hours}}h antes. Responda STOP para no recibir más mensajes.'),
  ('job_en_route', '{{technician_name}} de {{business_name}} va en camino, hora estimada {{eta}}.'),
  ('job_reminder', 'Recordatorio: {{business_name}} tiene una cita programada para {{arrival_window}}. Responda R para reprogramar o C para cancelar.'),
  ('job_rescheduled', 'Su cita con {{business_name}} se movió a {{arrival_window}}. Trabajo #{{job_number}}.'),
  ('review_request', 'Gracias por elegir {{business_name}}. Una reseña rápida ayuda mucho: {{review_link}} Responda STOP para no recibir más mensajes.')
) as s(trigger_event, body) on s.trigger_event = t.trigger_event
where t.language = 'en'
on conflict do nothing;
