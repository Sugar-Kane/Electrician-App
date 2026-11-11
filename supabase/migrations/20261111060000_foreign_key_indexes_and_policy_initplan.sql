-- Indexes for foreign keys that had none, and five row-level security
-- policies that read auth.uid() once per statement instead of once per row.
--
-- Additive and behaviour-preserving: every index is new (if not exists), and
-- each policy keeps exactly the same condition, only with auth.uid() wrapped in
-- a scalar subquery so Postgres evaluates it once. Who may see or change what
-- does not change.
--
-- The foreign keys on the task tables are left alone: the task list was
-- removed from the app and nothing queries them.

create index if not exists activity_events_booking_request_id_idx on public.activity_events (booking_request_id);
create index if not exists activity_events_customer_id_idx on public.activity_events (customer_id);
create index if not exists activity_events_job_id_idx on public.activity_events (job_id);
create index if not exists assistant_connections_created_by_idx on public.assistant_connections (created_by);
create index if not exists assistant_memories_created_by_idx on public.assistant_memories (created_by);
create index if not exists booking_calendar_events_organization_id_idx on public.booking_calendar_events (organization_id);
create index if not exists booking_requests_archived_by_idx on public.booking_requests (archived_by);
create index if not exists booking_requests_property_id_idx on public.booking_requests (property_id);
create index if not exists booking_requests_handled_by_idx on public.booking_requests (handled_by);
create index if not exists buy_list_items_created_by_idx on public.buy_list_items (created_by);
create index if not exists buy_list_items_inventory_item_id_idx on public.buy_list_items (inventory_item_id);
create index if not exists buy_list_items_supply_stop_id_idx on public.buy_list_items (supply_stop_id);
create index if not exists contract_templates_created_by_idx on public.contract_templates (created_by);
create index if not exists contracts_created_by_idx on public.contracts (created_by);
create index if not exists conversations_assistant_paused_by_idx on public.conversations (assistant_paused_by);
create index if not exists conversations_deleted_by_idx on public.conversations (deleted_by);
create index if not exists document_integrations_requested_by_idx on public.document_integrations (requested_by);
create index if not exists impersonation_sessions_organization_id_idx on public.impersonation_sessions (organization_id);
create index if not exists inventory_items_created_by_idx on public.inventory_items (created_by);
create index if not exists inventory_movements_created_by_idx on public.inventory_movements (created_by);
create index if not exists inventory_movements_job_id_idx on public.inventory_movements (job_id);
create index if not exists invoice_online_payments_job_id_idx on public.invoice_online_payments (job_id);
create index if not exists invoice_online_payments_organization_id_idx on public.invoice_online_payments (organization_id);
create index if not exists invoice_payments_job_id_idx on public.invoice_payments (job_id);
create index if not exists invoice_payments_organization_id_idx on public.invoice_payments (organization_id);
create index if not exists invoice_payments_recorded_by_idx on public.invoice_payments (recorded_by);
create index if not exists job_line_items_created_by_idx on public.job_line_items (created_by);
create index if not exists job_material_lists_created_by_idx on public.job_material_lists (created_by);
create index if not exists job_technician_progress_technician_id_idx on public.job_technician_progress (technician_id);
create index if not exists job_visits_ended_by_idx on public.job_visits (ended_by);
create index if not exists job_visits_job_id_idx on public.job_visits (job_id);
create index if not exists job_visits_technician_id_idx on public.job_visits (technician_id);
create index if not exists jobs_canceled_by_idx on public.jobs (canceled_by);
create index if not exists journal_post_revisions_created_by_idx on public.journal_post_revisions (created_by);
create index if not exists journal_post_revisions_organization_id_idx on public.journal_post_revisions (organization_id);
create index if not exists mcp_business_credentials_created_by_idx on public.mcp_business_credentials (created_by);
create index if not exists mcp_call_log_job_id_idx on public.mcp_call_log (job_id);
create index if not exists organization_ai_allowances_updated_by_idx on public.organization_ai_allowances (updated_by);
create index if not exists organization_ai_keys_created_by_idx on public.organization_ai_keys (created_by);
create index if not exists organization_invitations_accepted_by_idx on public.organization_invitations (accepted_by);
create index if not exists organization_invitations_invited_by_idx on public.organization_invitations (invited_by);
create index if not exists organization_members_impersonation_session_id_idx on public.organization_members (impersonation_session_id);
create index if not exists platform_admin_audit_admin_user_id_idx on public.platform_admin_audit (admin_user_id);
create index if not exists platform_admins_granted_by_idx on public.platform_admins (granted_by);
create index if not exists platform_settings_updated_by_idx on public.platform_settings (updated_by);
create index if not exists site_videos_created_by_idx on public.site_videos (created_by);
create index if not exists supplier_order_items_organization_id_idx on public.supplier_order_items (organization_id);
create index if not exists supplier_orders_approved_by_idx on public.supplier_orders (approved_by);
create index if not exists supplier_orders_created_by_idx on public.supplier_orders (created_by);
create index if not exists supply_stops_created_by_idx on public.supply_stops (created_by);
create index if not exists support_case_events_actor_user_id_idx on public.support_case_events (actor_user_id);
create index if not exists support_case_links_created_by_idx on public.support_case_links (created_by);
create index if not exists support_cases_assignee_idx on public.support_cases (assignee);
create index if not exists support_cases_opened_by_idx on public.support_cases (opened_by);
create index if not exists support_operations_actor_user_id_idx on public.support_operations (actor_user_id);
create index if not exists technician_date_hours_technician_id_idx on public.technician_date_hours (technician_id);
create index if not exists website_intake_keys_created_by_idx on public.website_intake_keys (created_by);

alter policy "owners manage business mcp credentials" on public.mcp_business_credentials
  using (exists (
    select 1 from public.organization_members as m
    where m.organization_id = mcp_business_credentials.organization_id
      and m.user_id = (select auth.uid()) and m.role = 'owner'
  ))
  with check (exists (
    select 1 from public.organization_members as m
    where m.organization_id = mcp_business_credentials.organization_id
      and m.user_id = (select auth.uid()) and m.role = 'owner'
  ));

alter policy "members read supplier orders" on public.supplier_orders
  using (exists (
    select 1 from public.organization_members as m
    where m.organization_id = supplier_orders.organization_id
      and m.user_id = (select auth.uid())
  ));

alter policy "owners manage supplier orders" on public.supplier_orders
  using (exists (
    select 1 from public.organization_members as m
    where m.organization_id = supplier_orders.organization_id
      and m.user_id = (select auth.uid()) and m.role = 'owner'
  ))
  with check (exists (
    select 1 from public.organization_members as m
    where m.organization_id = supplier_orders.organization_id
      and m.user_id = (select auth.uid()) and m.role = 'owner'
  ));

alter policy "members read supplier order items" on public.supplier_order_items
  using (exists (
    select 1 from public.organization_members as m
    where m.organization_id = supplier_order_items.organization_id
      and m.user_id = (select auth.uid())
  ));

alter policy "owners manage supplier order items" on public.supplier_order_items
  using (exists (
    select 1 from public.organization_members as m
    where m.organization_id = supplier_order_items.organization_id
      and m.user_id = (select auth.uid()) and m.role = 'owner'
  ))
  with check (exists (
    select 1 from public.organization_members as m
    where m.organization_id = supplier_order_items.organization_id
      and m.user_id = (select auth.uid()) and m.role = 'owner'
  ));
