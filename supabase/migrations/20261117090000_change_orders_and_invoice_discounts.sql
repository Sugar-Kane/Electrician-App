-- Change orders that add, change or remove work, and discounts on invoices.
--
-- Until now a change order was only a document: lines written after the
-- customer signed, listed in a contract of kind 'change_order' for them to
-- sign. It could add work and nothing else. A customer who wanted a fan taken
-- out, or three outlets instead of two, had no way to agree to it in writing.
--
-- 1. change_orders and change_order_items: what a change order asks for, item
--    by item — added, changed or removed — with the line each change touches
--    copied as it was, so a removal never erases what was agreed. The document
--    the customer signs is still a contracts row of kind 'change_order'; its
--    signature is what approves the change order, in the same transaction.
-- 2. apply_change_order: carries out an approved change order — lines and
--    invoices together, or not at all — from a plan the app works out, after
--    checking that nothing in the plan has moved underneath it.
-- 3. invoice_revisions: a sent invoice whose figures move keeps the figures it
--    had, who moved them and why, and whether the customer was sent the
--    updated one. Paid invoices are never revised.
-- 4. Discounts: a percentage or a fixed amount on an invoice, at most one.
-- 5. decline_change_order: the customer turning a change order down from the
--    link they were sent, with nothing changed.

-- ---------------------------------------------------------------------------
-- Invoices: a discount, and a revision count
-- ---------------------------------------------------------------------------

alter table public.invoices
  add column if not exists discount_type text,
  add column if not exists discount_value integer,
  add column if not exists discount_cents integer not null default 0,
  add column if not exists discount_reason text,
  add column if not exists discount_set_by uuid references auth.users (id) on delete set null,
  add column if not exists discount_set_at timestamptz,
  add column if not exists revision_number integer not null default 0;

alter table public.invoices drop constraint if exists invoices_discount_shape;
-- coalesce, because a check that comes out null passes: 'fixed' with no value
-- must be refused, not waved through.
alter table public.invoices add constraint invoices_discount_shape check (
  coalesce(
    (discount_type is null and discount_value is null)
    or (discount_type = 'percentage' and discount_value is not null and discount_value between 1 and 10000)
    or (discount_type = 'fixed' and discount_value is not null and discount_value >= 1),
    false
  )
);
alter table public.invoices drop constraint if exists invoices_discount_cents_range;
alter table public.invoices add constraint invoices_discount_cents_range check (
  discount_cents >= 0 and discount_cents <= greatest(subtotal_cents, 0)
);
alter table public.invoices drop constraint if exists invoices_discount_reason_length;
alter table public.invoices add constraint invoices_discount_reason_length check (
  discount_reason is null or char_length(discount_reason) <= 300
);
alter table public.invoices drop constraint if exists invoices_revision_number_nonnegative;
alter table public.invoices add constraint invoices_revision_number_nonnegative check (revision_number >= 0);

comment on column public.invoices.discount_type is
  'percentage or fixed; null when the invoice has no discount.';
comment on column public.invoices.discount_value is
  'Basis points for a percentage (1000 = 10%), cents for a fixed amount. Null with no discount.';
comment on column public.invoices.discount_cents is
  'What the discount takes off subtotal_cents, worked out by invoiceTotals. Zero with no discount.';
comment on column public.invoices.revision_number is
  'How many times the figures have moved after the invoice was raised by a change order or discount. 0 = as raised.';

-- ---------------------------------------------------------------------------
-- Change orders
-- ---------------------------------------------------------------------------

create table if not exists public.change_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  -- The agreement it amends. Null only for a job whose contract was deleted.
  base_contract_id uuid references public.contracts (id) on delete set null,
  -- The document the customer signs, once they have been asked.
  document_contract_id uuid references public.contracts (id) on delete set null,
  -- Change order #1, #2 on this job. Set by trigger.
  number integer not null default 0,
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  reason text check (reason is null or char_length(reason) <= 2000),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'canceled')),
  -- How it was agreed: the customer signed it, or (on an unsigned contract)
  -- it was folded into a revised draft the customer then signs.
  approval_method text check (approval_method is null or approval_method in ('customer_signature', 'contract_revision')),
  -- What the contract stood at, and what this adds, when the customer was
  -- asked. Fixed from then on: it is what they approve.
  original_contract_cents integer,
  net_cents integer not null default 0,
  requested_at timestamptz,
  requested_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  approved_by_name text,
  rejected_at timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 1000),
  canceled_at timestamptz,
  canceled_by uuid references auth.users (id) on delete set null,
  -- When its lines and invoices were changed. Approved and not applied means
  -- the app has that still to do (and the job page offers to finish it).
  applied_at timestamptz,
  -- Owed back to the customer because of it: a reduction on a paid invoice,
  -- or a revised invoice now below what was paid on it.
  credit_due_cents integer not null default 0 check (credit_due_cents >= 0),
  -- Bumped on every edit, so two people editing one draft cannot overwrite
  -- each other without knowing.
  version integer not null default 1 check (version >= 1),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, number),
  unique (document_contract_id),
  constraint change_orders_approved_complete check (
    status <> 'approved' or (approved_at is not null and approval_method is not null)
  ),
  constraint change_orders_applied_only_when_approved check (applied_at is null or status = 'approved')
);

comment on table public.change_orders is
  'A change to agreed work: additions, changes and removals (change_order_items), approved by the customer signing document_contract_id. Only approved ones move the contract total.';

create index if not exists change_orders_organization_idx on public.change_orders (organization_id, created_at desc);
create index if not exists change_orders_job_idx on public.change_orders (job_id, number);
create index if not exists change_orders_base_contract_idx on public.change_orders (base_contract_id) where base_contract_id is not null;
create index if not exists change_orders_requested_by_idx on public.change_orders (requested_by) where requested_by is not null;
create index if not exists change_orders_canceled_by_idx on public.change_orders (canceled_by) where canceled_by is not null;
create index if not exists change_orders_created_by_idx on public.change_orders (created_by) where created_by is not null;

-- One change order out for signature per job at a time, as with contracts:
-- only the job's newest document can be signed.
create unique index if not exists change_orders_one_pending_per_job_idx
  on public.change_orders (job_id)
  where status = 'pending_approval';

create table if not exists public.change_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  change_order_id uuid not null references public.change_orders (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  action text not null check (action in ('add', 'modify', 'remove')),
  kind text not null check (kind in ('labor', 'material')),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text not null default 'each' check (char_length(unit) between 1 and 24),
  -- The customer's price each, admin fee included. Null until somebody who may
  -- set prices prices it; a removal is priced by the line it removes.
  unit_price_cents integer check (unit_price_cents is null or unit_price_cents >= 0),
  admin_fee_cents integer check (admin_fee_cents is null or admin_fee_cents >= 0),
  unit_cost_cents integer check (unit_cost_cents is null or unit_cost_cents >= 0),
  inventory_item_id uuid references public.inventory_items (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 1000),
  -- The job line it changes or removes; for an addition, the line it became.
  line_id uuid references public.job_line_items (id) on delete set null,
  -- An addition that was already on the job (written after the customer
  -- signed), swept in so the customer signs for it. Approving adds no line.
  existing_line boolean not null default false,
  -- The line as it was when this item was written. Kept for good: a removal
  -- never erases what the customer originally agreed to.
  original_description text,
  original_quantity numeric(12, 3),
  original_unit text,
  original_unit_price_cents integer,
  original_admin_fee_cents integer,
  original_invoice_id uuid references public.invoices (id) on delete set null,
  -- What this item adds or takes off, in cents, as last worked out.
  net_cents integer not null default 0,
  -- Once applied: where it landed, and which invoice billed it.
  applied_effect text check (applied_effect is null or applied_effect in ('unbilled', 'draft', 'revision', 'supplemental', 'credit', 'none')),
  billed_invoice_id uuid references public.invoices (id) on delete set null,
  -- A caller's key for this item (ChatGPT retries), so the same request twice
  -- adds one item.
  request_key text check (request_key is null or char_length(request_key) between 1 and 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint change_order_items_target check (
    -- An addition has no line to copy; once applied, line_id is the line it became.
    (action = 'add' and original_quantity is null)
    or (action in ('modify', 'remove') and original_quantity is not null and original_unit_price_cents is not null)
  )
);

create index if not exists change_order_items_order_idx on public.change_order_items (change_order_id, created_at);
create index if not exists change_order_items_organization_idx on public.change_order_items (organization_id);
create index if not exists change_order_items_job_idx on public.change_order_items (job_id);
create index if not exists change_order_items_line_idx on public.change_order_items (line_id) where line_id is not null;
create index if not exists change_order_items_inventory_idx on public.change_order_items (inventory_item_id) where inventory_item_id is not null;
create index if not exists change_order_items_original_invoice_idx on public.change_order_items (original_invoice_id) where original_invoice_id is not null;
create index if not exists change_order_items_billed_invoice_idx on public.change_order_items (billed_invoice_id) where billed_invoice_id is not null;
create index if not exists change_order_items_created_by_idx on public.change_order_items (created_by) where created_by is not null;
create unique index if not exists change_order_items_request_key_idx
  on public.change_order_items (change_order_id, request_key)
  where request_key is not null;

-- Which change order a job line came from or was last changed by. A line
-- written after the customer signed is no longer "unsigned" once a change
-- order they approved covers it.
alter table public.job_line_items
  add column if not exists change_order_id uuid references public.change_orders (id) on delete set null;
create index if not exists job_line_items_change_order_idx
  on public.job_line_items (change_order_id)
  where change_order_id is not null;

-- ---------------------------------------------------------------------------
-- Invoice revisions
-- ---------------------------------------------------------------------------

create table if not exists public.invoice_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  revision_number integer not null check (revision_number >= 1),
  change_order_id uuid references public.change_orders (id) on delete set null,
  reason text not null check (reason in ('change_order', 'discount')),
  -- The figures before and after, as the invoice row held them.
  previous jsonb not null,
  next jsonb not null,
  subtotal_delta_cents integer not null default 0,
  credit_due_cents integer not null default 0 check (credit_due_cents >= 0),
  -- Whether the customer is to be sent the updated invoice, and what happened.
  resend_status text not null default 'not_needed'
    check (resend_status in ('not_needed', 'pending', 'sending', 'sent', 'failed')),
  resend_claimed_at timestamptz,
  resent_at timestamptz,
  resend_detail text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (invoice_id, revision_number)
);

comment on table public.invoice_revisions is
  'Every time an invoice''s figures moved after it was raised: before and after, why, and whether the customer was sent the update. Written only by apply_change_order and set_invoice_discount.';

-- One revision per change order per invoice: an apply retried after it
-- succeeded cannot revise (or resend) the same invoice twice.
create unique index if not exists invoice_revisions_one_per_change_order_idx
  on public.invoice_revisions (invoice_id, change_order_id)
  where change_order_id is not null;
create index if not exists invoice_revisions_organization_idx on public.invoice_revisions (organization_id, created_at desc);
create index if not exists invoice_revisions_change_order_idx on public.invoice_revisions (change_order_id) where change_order_id is not null;
create index if not exists invoice_revisions_created_by_idx on public.invoice_revisions (created_by) where created_by is not null;
create index if not exists invoice_revisions_pending_idx on public.invoice_revisions (organization_id, resend_status)
  where resend_status in ('pending', 'sending', 'failed');

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.change_orders enable row level security;
alter table public.change_order_items enable row level security;
alter table public.invoice_revisions enable row level security;

create policy "Organization members can view change orders"
  on public.change_orders for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "Organization members can start change orders"
  on public.change_orders for insert to authenticated
  with check ((select private.is_org_member(organization_id)) and status = 'draft' and applied_at is null);

-- A member may edit a draft, send it, withdraw it, or record that the customer
-- declined. Never approve it: approval is the customer's signature, recorded
-- by the database when they sign.
create policy "Organization members can change open change orders"
  on public.change_orders for update to authenticated
  using ((select private.is_org_member(organization_id)) and status in ('draft', 'pending_approval'))
  with check (
    (select private.is_org_member(organization_id))
    and status in ('draft', 'pending_approval', 'canceled', 'rejected')
    and applied_at is null
  );

create policy "Organization members can delete draft change orders"
  on public.change_orders for delete to authenticated
  using ((select private.is_org_member(organization_id)) and status = 'draft');

create policy "Organization members can view change order items"
  on public.change_order_items for select to authenticated
  using ((select private.is_org_member(organization_id)));

-- Items move only while their change order is a draft.
create policy "Organization members can add change order items"
  on public.change_order_items for insert to authenticated
  with check (
    (select private.is_org_member(organization_id))
    and exists (
      select 1 from public.change_orders as parent
      where parent.id = change_order_id and parent.status = 'draft'
    )
  );

create policy "Organization members can change change order items"
  on public.change_order_items for update to authenticated
  using (
    (select private.is_org_member(organization_id))
    and exists (
      select 1 from public.change_orders as parent
      where parent.id = change_order_id and parent.status = 'draft'
    )
  )
  with check (
    (select private.is_org_member(organization_id))
    and applied_effect is null
    and exists (
      select 1 from public.change_orders as parent
      where parent.id = change_order_id and parent.status = 'draft'
    )
  );

create policy "Organization members can remove change order items"
  on public.change_order_items for delete to authenticated
  using (
    (select private.is_org_member(organization_id))
    and exists (
      select 1 from public.change_orders as parent
      where parent.id = change_order_id and parent.status = 'draft'
    )
  );

-- Read-only to members: revisions are written by the functions below.
create policy "Organization members can view invoice revisions"
  on public.invoice_revisions for select to authenticated
  using ((select private.is_org_member(organization_id)));

create trigger set_change_orders_updated_at
  before update on public.change_orders
  for each row execute function public.set_updated_at();

create trigger set_change_order_items_updated_at
  before update on public.change_order_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

/*
 * A change order's number, its job and its business, from the database.
 *
 * The number is the next one on the job, under a per-job lock so two started
 * at once cannot both be #3. The documents it points at must be this job's
 * contracts: an id from another job, or another business, is refused here
 * whichever client wrote it.
 */
create or replace function private.prepare_change_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  job_org uuid;
begin
  select job.organization_id into job_org from public.jobs as job where job.id = new.job_id;
  if job_org is null or job_org <> new.organization_id then
    raise exception 'That job is not in this business.' using errcode = '23514';
  end if;

  if new.base_contract_id is not null and not exists (
    select 1 from public.contracts as contract
    where contract.id = new.base_contract_id and contract.job_id = new.job_id
      and contract.organization_id = new.organization_id and contract.kind = 'agreement'
  ) then
    raise exception 'A change order amends an agreement on the same job.' using errcode = '23514';
  end if;

  if new.document_contract_id is not null
    and new.document_contract_id is distinct from (case when tg_op = 'UPDATE' then old.document_contract_id end)
    and not exists (
      select 1 from public.contracts as contract
      where contract.id = new.document_contract_id and contract.job_id = new.job_id
        and contract.organization_id = new.organization_id and contract.kind = 'change_order'
    ) then
    raise exception 'A change order''s document is a change order on the same job.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('change_order:' || new.job_id::text, 0));
    select coalesce(max(existing.number), 0) + 1 into new.number
    from public.change_orders as existing
    where existing.job_id = new.job_id;
    return new;
  end if;

  -- The job, business and number never move.
  new.organization_id := old.organization_id;
  new.job_id := old.job_id;
  new.number := old.number;

  -- Approval and application are recorded by the functions below, never by
  -- an update from the app — not even one with the service role.
  if (new.status = 'approved' and old.status <> 'approved')
     or new.approved_at is distinct from old.approved_at
     or new.approval_method is distinct from old.approval_method then
    if coalesce(pg_catalog.current_setting('volteira.change_order_approval', true), '') <> 'on' then
      raise exception 'A change order is approved by the customer signing it.' using errcode = '42501';
    end if;
  end if;
  if new.applied_at is distinct from old.applied_at or new.credit_due_cents is distinct from old.credit_due_cents then
    if coalesce(pg_catalog.current_setting('volteira.change_order_apply', true), '') <> 'on' then
      raise exception 'A change order is applied by apply_change_order.' using errcode = '42501';
    end if;
  end if;
  -- An answered change order is history.
  if old.status in ('approved', 'rejected', 'canceled') and (
    new.status is distinct from old.status
    or new.description is distinct from old.description
    or new.net_cents is distinct from old.net_cents
    or new.reason is distinct from old.reason
  ) then
    raise exception 'This change order has been answered and can no longer change.' using errcode = '42501';
  end if;
  -- What the customer was asked is fixed once they have been asked.
  if old.status = 'pending_approval' and (
    new.description is distinct from old.description
    or new.net_cents is distinct from old.net_cents
    or new.original_contract_cents is distinct from old.original_contract_cents
  ) then
    raise exception 'This change order is with the customer. Withdraw it to change it.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function private.prepare_change_order() from public, anon, authenticated;

create trigger change_orders_prepare
  before insert or update on public.change_orders
  for each row execute function private.prepare_change_order();

-- An item takes its business and job from its change order, whatever the
-- caller sent, and its target line must be on that job.
create or replace function private.prepare_change_order_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  parent record;
begin
  select change_order.organization_id, change_order.job_id into parent
  from public.change_orders as change_order
  where change_order.id = new.change_order_id;
  if parent.job_id is null then
    raise exception 'That change order does not exist.' using errcode = '23503';
  end if;
  new.organization_id := parent.organization_id;
  new.job_id := parent.job_id;

  if new.line_id is not null
    and new.line_id is distinct from (case when tg_op = 'UPDATE' then old.line_id end)
    and not exists (
      select 1 from public.job_line_items as line
      where line.id = new.line_id and line.job_id = parent.job_id
    ) then
    raise exception 'That item is not on this job.' using errcode = '23514';
  end if;

  if new.inventory_item_id is not null
    and new.inventory_item_id is distinct from (case when tg_op = 'UPDATE' then old.inventory_item_id end)
    and not exists (
      select 1 from public.inventory_items as item
      where item.id = new.inventory_item_id and item.organization_id = parent.organization_id
    ) then
    raise exception 'That part is not in this business''s stock.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function private.prepare_change_order_item() from public, anon, authenticated;

create trigger change_order_items_prepare
  before insert or update on public.change_order_items
  for each row execute function private.prepare_change_order_item();

-- ---------------------------------------------------------------------------
-- Approval: the customer's signature on the change order's document
-- ---------------------------------------------------------------------------

/*
 * Signing the document approves the change order, in the same transaction as
 * the signature. There is no other way to approve one: the guard above refuses
 * every other path. A signature on a document whose change order is no longer
 * waiting (withdrawn a moment before) approves nothing — and cannot happen,
 * because withdrawing voids the document first and a void one cannot be signed.
 */
create or replace function private.approve_signed_change_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.kind = 'change_order' and new.signed_at is not null and old.signed_at is null then
    perform pg_catalog.set_config('volteira.change_order_approval', 'on', true);
    update public.change_orders as change_order
    set status = 'approved',
        approval_method = 'customer_signature',
        approved_at = new.signed_at,
        approved_by_name = new.signature_name
    where change_order.document_contract_id = new.id
      and change_order.status = 'pending_approval';
    perform pg_catalog.set_config('volteira.change_order_approval', '', true);
  end if;
  return new;
end;
$function$;

revoke all on function private.approve_signed_change_order() from public, anon, authenticated;

drop trigger if exists contracts_approve_change_order on public.contracts;
create trigger contracts_approve_change_order
  after update of signed_at on public.contracts
  for each row execute function private.approve_signed_change_order();

/*
 * An unsigned contract updated instead of amended: the change is folded into a
 * revised draft, which the customer then signs as the contract. Approved by a
 * member of the business (the customer has signed nothing yet), and only
 * while the change order is a draft against an agreement nobody has signed.
 */
create or replace function public.approve_change_order_as_contract_revision(p_change_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target record;
begin
  select change_order.id, change_order.organization_id, change_order.status, change_order.base_contract_id
    into target
  from public.change_orders as change_order
  where change_order.id = p_change_order_id
  for update;

  if target.id is null then
    raise exception 'change order not found' using errcode = 'P0002';
  end if;
  -- No user is the service role: anon cannot execute this function.
  if (select auth.uid()) is not null and not private.is_org_member(target.organization_id) then
    raise exception 'change order not found' using errcode = 'P0002';
  end if;
  if target.status <> 'draft' then
    raise exception 'only a draft can be folded into the contract' using errcode = '22023';
  end if;
  if target.base_contract_id is not null and exists (
    select 1 from public.contracts as contract
    where contract.id = target.base_contract_id and contract.signed_at is not null
  ) then
    raise exception 'the contract is signed: the customer approves a change order instead' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('volteira.change_order_approval', 'on', true);
  update public.change_orders
  set status = 'approved',
      approval_method = 'contract_revision',
      approved_at = pg_catalog.now(),
      requested_at = coalesce(requested_at, pg_catalog.now()),
      requested_by = coalesce(requested_by, (select auth.uid()))
  where id = target.id;
  perform pg_catalog.set_config('volteira.change_order_approval', '', true);
  return target.id;
end;
$function$;

revoke all on function public.approve_change_order_as_contract_revision(uuid) from public, anon;
grant execute on function public.approve_change_order_as_contract_revision(uuid) to authenticated, service_role;

/*
 * The customer turning a change order down, from their link.
 *
 * The same refusals as signing: only a change order still waiting, only the
 * job's newest document. Nothing on the job changes; the document is voided so
 * it can no longer be signed, and the change order records the answer.
 */
create or replace function public.decline_change_order(p_token uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  document record;
  declined uuid;
begin
  select contract.id, contract.job_id, contract.created_at
    into document
  from public.contracts as contract
  where contract.public_token = p_token
    and contract.kind = 'change_order'
    and contract.signed_at is null
    and contract.status <> 'void'
  for update;

  if document.id is null then
    return null;
  end if;

  if exists (
    select 1 from public.contracts as newer
    where newer.job_id = document.job_id
      and newer.id <> document.id
      and newer.status <> 'void'
      and newer.created_at > document.created_at
  ) then
    return null;
  end if;

  update public.change_orders as change_order
  set status = 'rejected',
      rejected_at = pg_catalog.now(),
      rejection_reason = nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 1000), '')
  where change_order.document_contract_id = document.id
    and change_order.status = 'pending_approval'
  returning change_order.id into declined;

  if declined is null then
    return null;
  end if;

  update public.contracts set status = 'void' where id = document.id and signed_at is null;
  return declined;
end;
$function$;

revoke all on function public.decline_change_order(uuid, text) from public;
grant execute on function public.decline_change_order(uuid, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Applying an approved change order
-- ---------------------------------------------------------------------------

/*
 * Carry out an approved change order: the plan the app worked out, all of it
 * or none of it.
 *
 * The plan names what every line and invoice it touches must still say. Each
 * is locked and compared before anything is written; one that has moved (a
 * payment landed, somebody edited a line) fails the whole call with 40001, and
 * the app works the plan out again from what is there now. Applying twice does
 * nothing the second time.
 *
 * Service role only: the app calls it after checking who is asking, or after
 * the customer's signature approved the change order.
 */
create or replace function public.apply_change_order(p_change_order_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target record;
  entry jsonb;
  current_line record;
  current_invoice record;
  revision_id uuid;
  revisions jsonb := '[]'::jsonb;
  next jsonb;
begin
  select change_order.* into target
  from public.change_orders as change_order
  where change_order.id = p_change_order_id
  for update;

  if target.id is null then
    raise exception 'change order not found' using errcode = 'P0002';
  end if;
  if target.applied_at is not null then
    return pg_catalog.jsonb_build_object('already_applied', true, 'revisions', '[]'::jsonb);
  end if;
  if target.status <> 'approved' then
    raise exception 'only an approved change order is applied' using errcode = '22023';
  end if;

  -- Invoices first, locked and checked.
  for entry in select * from pg_catalog.jsonb_array_elements(coalesce(p_plan -> 'invoiceRevisions', '[]'::jsonb)) loop
    select invoice.* into current_invoice
    from public.invoices as invoice
    where invoice.id = (entry ->> 'invoice_id')::uuid
      and invoice.organization_id = target.organization_id
      and invoice.job_id = target.job_id
    for update;
    if current_invoice.id is null
      or current_invoice.status <> entry -> 'expected' ->> 'status'
      or current_invoice.subtotal_cents <> (entry -> 'expected' ->> 'subtotal_cents')::integer
      or current_invoice.total_cents <> (entry -> 'expected' ->> 'total_cents')::integer
      or current_invoice.balance_due_cents <> (entry -> 'expected' ->> 'balance_due_cents')::integer
      or current_invoice.revision_number <> (entry -> 'expected' ->> 'revision_number')::integer
      or current_invoice.paid_at is not null
      or current_invoice.stripe_invoice_id is not null then
      raise exception 'invoice % changed since the plan was made', entry ->> 'invoice_id' using errcode = '40001';
    end if;
    next := entry -> 'next';
    -- The figures must add up the way invoiceTotals adds them.
    if (next ->> 'total_cents')::integer <> greatest(0,
         (next ->> 'subtotal_cents')::integer - (next ->> 'discount_cents')::integer
         - (next ->> 'diagnostic_credit_cents')::integer + (next ->> 'tax_cents')::integer)
       or (next ->> 'balance_due_cents')::integer < 0
       or (next ->> 'balance_due_cents')::integer > (next ->> 'total_cents')::integer then
      raise exception 'the revised figures for invoice % do not add up', entry ->> 'invoice_id' using errcode = '22023';
    end if;
  end loop;

  -- Lines to change or remove, locked and checked.
  for entry in
    select * from pg_catalog.jsonb_array_elements(coalesce(p_plan -> 'lineUpdates', '[]'::jsonb))
    union all
    select * from pg_catalog.jsonb_array_elements(coalesce(p_plan -> 'lineDeletes', '[]'::jsonb))
  loop
    select line.id, line.quantity, line.unit_price_cents, line.invoice_id into current_line
    from public.job_line_items as line
    where line.id = (entry ->> 'id')::uuid
      and line.job_id = target.job_id
      and line.organization_id = target.organization_id
    for update;
    if current_line.id is null
      or current_line.quantity <> (entry -> 'expected' ->> 'quantity')::numeric
      or current_line.unit_price_cents <> (entry -> 'expected' ->> 'unit_price_cents')::integer
      or current_line.invoice_id is distinct from nullif(entry -> 'expected' ->> 'invoice_id', '')::uuid then
      raise exception 'line % changed since the plan was made', entry ->> 'id' using errcode = '40001';
    end if;
  end loop;

  -- New lines. The admin fee is given, so the line trigger leaves the price as
  -- the customer approved it.
  insert into public.job_line_items (
    id, organization_id, job_id, kind, description, quantity, unit, unit_price_cents, admin_fee_cents,
    unit_cost_cents, inventory_item_id, notes, invoice_id, change_order_id, created_by
  )
  select
    (line ->> 'id')::uuid, target.organization_id, target.job_id, line ->> 'kind', line ->> 'description',
    (line ->> 'quantity')::numeric, line ->> 'unit', (line ->> 'unit_price_cents')::integer,
    (line ->> 'admin_fee_cents')::integer, nullif(line ->> 'unit_cost_cents', '')::integer,
    (select item.id from public.inventory_items as item
      where item.id = nullif(line ->> 'inventory_item_id', '')::uuid and item.organization_id = target.organization_id),
    nullif(line ->> 'notes', ''),
    (select invoice.id from public.invoices as invoice
      where invoice.id = nullif(line ->> 'invoice_id', '')::uuid and invoice.job_id = target.job_id),
    target.id, target.requested_by
  from pg_catalog.jsonb_array_elements(coalesce(p_plan -> 'lineInserts', '[]'::jsonb)) as line;

  -- Changed lines.
  update public.job_line_items as line
  set description = entry_line.value -> 'next' ->> 'description',
      quantity = (entry_line.value -> 'next' ->> 'quantity')::numeric,
      unit = entry_line.value -> 'next' ->> 'unit',
      unit_price_cents = (entry_line.value -> 'next' ->> 'unit_price_cents')::integer,
      admin_fee_cents = (entry_line.value -> 'next' ->> 'admin_fee_cents')::integer,
      change_order_id = target.id
  from pg_catalog.jsonb_array_elements(coalesce(p_plan -> 'lineUpdates', '[]'::jsonb)) as entry_line
  where line.id = (entry_line.value ->> 'id')::uuid
    and line.job_id = target.job_id;

  -- Removed lines: any stock they took goes back first, written as the
  -- opposite movement (the same rule returnStock follows in the app), because
  -- the movement must name the line before the line is gone.
  insert into public.inventory_movements (organization_id, item_id, quantity, reason, job_id, job_line_item_id, unit_cost_cents, note)
  select target.organization_id, owed.item_id, -owed.quantity, 'returned', target.job_id, owed.line_id, owed.unit_cost_cents,
         'Removed from the job by change order #' || target.number
  from (
    select movement.job_line_item_id as line_id, movement.item_id,
           sum(movement.quantity) as quantity,
           coalesce(max(movement.unit_cost_cents) filter (where movement.reason = 'used_on_job'), 0) as unit_cost_cents
    from public.inventory_movements as movement
    where movement.organization_id = target.organization_id
      and movement.job_line_item_id in (
        select (removed.value ->> 'id')::uuid
        from pg_catalog.jsonb_array_elements(coalesce(p_plan -> 'lineDeletes', '[]'::jsonb)) as removed
      )
    group by movement.job_line_item_id, movement.item_id
  ) as owed
  where pg_catalog.round(owed.quantity, 2) < 0;

  delete from public.job_line_items as line
  where line.job_id = target.job_id
    and line.id in (
      select (removed.value ->> 'id')::uuid
      from pg_catalog.jsonb_array_elements(coalesce(p_plan -> 'lineDeletes', '[]'::jsonb)) as removed
    );

  -- Lines already on the job that the customer has now agreed to.
  update public.job_line_items as line
  set change_order_id = target.id
  where line.job_id = target.job_id
    and line.id in (
      select (covered.value #>> '{}')::uuid
      from pg_catalog.jsonb_array_elements(coalesce(p_plan -> 'coveredLineIds', '[]'::jsonb)) as covered
    );

  -- The invoices, each with the figures it had kept as a revision.
  for entry in select * from pg_catalog.jsonb_array_elements(coalesce(p_plan -> 'invoiceRevisions', '[]'::jsonb)) loop
    next := entry -> 'next';
    select invoice.* into current_invoice from public.invoices as invoice where invoice.id = (entry ->> 'invoice_id')::uuid;

    insert into public.invoice_revisions (
      organization_id, invoice_id, revision_number, change_order_id, reason, previous, next,
      subtotal_delta_cents, credit_due_cents, resend_status, created_by
    ) values (
      target.organization_id, current_invoice.id, (next ->> 'revision_number')::integer, target.id, 'change_order',
      pg_catalog.jsonb_build_object(
        'status', current_invoice.status,
        'subtotal_cents', current_invoice.subtotal_cents,
        'discount_cents', current_invoice.discount_cents,
        'diagnostic_credit_cents', current_invoice.diagnostic_credit_cents,
        'tax_cents', current_invoice.tax_cents,
        'total_cents', current_invoice.total_cents,
        'balance_due_cents', current_invoice.balance_due_cents
      ),
      next - 'paid_now',
      coalesce((entry ->> 'subtotal_delta_cents')::integer, 0),
      coalesce((entry ->> 'credit_due_cents')::integer, 0),
      case when (entry ->> 'resend')::boolean then 'pending' else 'not_needed' end,
      target.requested_by
    )
    returning id into revision_id;

    update public.invoices
    set subtotal_cents = (next ->> 'subtotal_cents')::integer,
        discount_cents = (next ->> 'discount_cents')::integer,
        diagnostic_credit_cents = (next ->> 'diagnostic_credit_cents')::integer,
        tax_cents = (next ->> 'tax_cents')::integer,
        total_cents = (next ->> 'total_cents')::integer,
        balance_due_cents = (next ->> 'balance_due_cents')::integer,
        status = next ->> 'status',
        stripe_application_fee_cents = (next ->> 'stripe_application_fee_cents')::integer,
        revision_number = (next ->> 'revision_number')::integer,
        paid_at = case when (next ->> 'paid_now')::boolean then pg_catalog.now() else paid_at end
    where id = current_invoice.id;

    revisions := revisions || pg_catalog.jsonb_build_object(
      'revision_id', revision_id,
      'invoice_id', current_invoice.id,
      'resend', (entry ->> 'resend')::boolean
    );
  end loop;

  -- Where each item landed.
  update public.change_order_items as item
  set applied_effect = effect.value ->> 'effect',
      billed_invoice_id = (select invoice.id from public.invoices as invoice
        where invoice.id = nullif(effect.value ->> 'billed_invoice_id', '')::uuid and invoice.job_id = target.job_id),
      line_id = coalesce(
        (select line.id from public.job_line_items as line
          where line.id = nullif(effect.value ->> 'line_id', '')::uuid and line.job_id = target.job_id),
        case when item.action = 'remove' then null else item.line_id end
      )
  from pg_catalog.jsonb_array_elements(coalesce(p_plan -> 'itemEffects', '[]'::jsonb)) as effect
  where item.id = (effect.value ->> 'item_id')::uuid
    and item.change_order_id = target.id;

  perform pg_catalog.set_config('volteira.change_order_apply', 'on', true);
  update public.change_orders
  set applied_at = pg_catalog.now(),
      credit_due_cents = greatest(0, coalesce((p_plan ->> 'creditDueCents')::integer, 0))
  where id = target.id;
  perform pg_catalog.set_config('volteira.change_order_apply', '', true);

  return pg_catalog.jsonb_build_object('already_applied', false, 'revisions', revisions);
end;
$function$;

revoke all on function public.apply_change_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_change_order(uuid, jsonb) to service_role;

/*
 * Lines a change order left unbilled (no invoice yet, or a paid one) are billed
 * by the next invoice raised on the job. This records that invoice on the
 * items, so the invoice can show what each change order added.
 */
create or replace function public.attribute_change_orders_to_invoice(p_invoice_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  invoice record;
  touched integer;
begin
  select i.id, i.organization_id, i.job_id into invoice from public.invoices as i where i.id = p_invoice_id;
  if invoice.id is null or invoice.job_id is null then
    return 0;
  end if;
  -- No user is the service role: anon cannot execute this function.
  if (select auth.uid()) is not null and not private.is_org_member(invoice.organization_id) then
    return 0;
  end if;

  update public.change_order_items as item
  set billed_invoice_id = invoice.id
  where item.job_id = invoice.job_id
    and item.organization_id = invoice.organization_id
    and item.applied_effect in ('unbilled', 'supplemental')
    and item.billed_invoice_id is null;
  get diagnostics touched = row_count;
  return touched;
end;
$function$;

revoke all on function public.attribute_change_orders_to_invoice(uuid) from public, anon;
grant execute on function public.attribute_change_orders_to_invoice(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Discounts
-- ---------------------------------------------------------------------------

/*
 * Set, change or take off an invoice's discount, with the figures that follow.
 *
 * The figures are worked out by the app (invoiceTotals) and checked here: they
 * must add up, and the invoice must still say what the app read. A draft simply
 * moves. A sent invoice keeps the figures it had as a revision; one with money
 * paid on it cannot be discounted below what was paid, and a paid, void or
 * Stripe-collected invoice cannot be discounted at all.
 *
 * Billing permission is checked here for a signed-in member. The service role
 * (ChatGPT) is checked by the app, against the person who connected it.
 */
create or replace function public.set_invoice_discount(
  p_invoice_id uuid,
  p_expected jsonb,
  p_next jsonb,
  p_discount_type text,
  p_discount_value integer,
  p_reason text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  invoice record;
  paid_so_far integer;
  revised boolean;
  revision_id uuid;
  next_balance integer;
begin
  select i.* into invoice from public.invoices as i where i.id = p_invoice_id for update;
  if invoice.id is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  -- No user is the service role (anon cannot execute this function), which
  -- the app only uses after checking the connected owner itself.
  if (select auth.uid()) is not null then
    if not private.is_org_member(invoice.organization_id) then
      raise exception 'invoice not found' using errcode = 'P0002';
    end if;
    if not private.can_edit_billing(invoice.organization_id) then
      raise exception 'billing changes are turned off for technicians in this business' using errcode = '42501';
    end if;
  end if;

  if invoice.status = 'void' or invoice.status = 'paid' or invoice.paid_at is not null then
    raise exception 'a paid or void invoice cannot be discounted' using errcode = '22023';
  end if;
  if invoice.stripe_invoice_id is not null then
    raise exception 'this invoice is collected through Stripe and cannot be discounted here' using errcode = '22023';
  end if;
  if invoice.subtotal_cents <> (p_expected ->> 'subtotal_cents')::integer
     or invoice.total_cents <> (p_expected ->> 'total_cents')::integer
     or invoice.balance_due_cents <> (p_expected ->> 'balance_due_cents')::integer
     or invoice.revision_number <> (p_expected ->> 'revision_number')::integer
     or invoice.status <> p_expected ->> 'status' then
    raise exception 'the invoice changed a moment ago' using errcode = '40001';
  end if;
  if (p_next ->> 'subtotal_cents')::integer <> invoice.subtotal_cents
     or (p_next ->> 'total_cents')::integer <> greatest(0,
        (p_next ->> 'subtotal_cents')::integer - (p_next ->> 'discount_cents')::integer
        - (p_next ->> 'diagnostic_credit_cents')::integer + (p_next ->> 'tax_cents')::integer) then
    raise exception 'the discounted figures do not add up' using errcode = '22023';
  end if;

  paid_so_far := greatest(0, invoice.total_cents - invoice.balance_due_cents);
  if (p_next ->> 'total_cents')::integer < paid_so_far then
    raise exception 'that discount would bring the invoice below what has already been paid on it' using errcode = '22023';
  end if;
  next_balance := (p_next ->> 'total_cents')::integer - paid_so_far;
  revised := invoice.last_sent_at is not null or invoice.status <> 'draft';

  if revised then
    insert into public.invoice_revisions (
      organization_id, invoice_id, revision_number, reason, previous, next, subtotal_delta_cents, resend_status, created_by
    ) values (
      invoice.organization_id, invoice.id, invoice.revision_number + 1, 'discount',
      pg_catalog.jsonb_build_object(
        'status', invoice.status, 'subtotal_cents', invoice.subtotal_cents, 'discount_cents', invoice.discount_cents,
        'discount_type', invoice.discount_type, 'discount_value', invoice.discount_value,
        'diagnostic_credit_cents', invoice.diagnostic_credit_cents, 'tax_cents', invoice.tax_cents,
        'total_cents', invoice.total_cents, 'balance_due_cents', invoice.balance_due_cents
      ),
      p_next || pg_catalog.jsonb_build_object('discount_type', p_discount_type, 'discount_value', p_discount_value, 'balance_due_cents', next_balance),
      0, 'not_needed', coalesce(p_actor, (select auth.uid()))
    )
    returning id into revision_id;
  end if;

  update public.invoices
  set discount_type = p_discount_type,
      discount_value = p_discount_value,
      discount_cents = (p_next ->> 'discount_cents')::integer,
      discount_reason = case when p_discount_type is null then null else nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 300), '') end,
      discount_set_by = coalesce(p_actor, (select auth.uid())),
      discount_set_at = pg_catalog.now(),
      diagnostic_credit_cents = (p_next ->> 'diagnostic_credit_cents')::integer,
      tax_cents = (p_next ->> 'tax_cents')::integer,
      total_cents = (p_next ->> 'total_cents')::integer,
      balance_due_cents = next_balance,
      -- Discounted down to exactly what was paid: paid.
      status = case when revised and next_balance = 0 and paid_so_far > 0 then 'paid' else invoice.status end,
      paid_at = case when revised and next_balance = 0 and paid_so_far > 0 then pg_catalog.now() else invoice.paid_at end,
      stripe_application_fee_cents = (p_next ->> 'stripe_application_fee_cents')::integer,
      revision_number = case when revised then invoice.revision_number + 1 else invoice.revision_number end
  where id = invoice.id;

  return pg_catalog.jsonb_build_object('revised', revised, 'revision_id', revision_id, 'balance_due_cents', next_balance);
end;
$function$;

revoke all on function public.set_invoice_discount(uuid, jsonb, jsonb, text, integer, text, uuid) from public, anon;
grant execute on function public.set_invoice_discount(uuid, jsonb, jsonb, text, integer, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The customer's invoice link: the discount and what change orders added
-- ---------------------------------------------------------------------------

-- Beside get_invoice_by_link rather than in it, so that function's columns
-- stay exactly as they were (as get_invoice_label_by_link did).
create or replace function public.get_invoice_adjustments_by_link(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select pg_catalog.jsonb_build_object(
    'discount_type', invoice.discount_type,
    'discount_value', invoice.discount_value,
    'discount_cents', invoice.discount_cents,
    'revision_number', invoice.revision_number,
    'change_orders', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('number', grouped.number, 'amount_cents', grouped.amount_cents) order by grouped.number)
      from (
        select change_order.number, sum(item.net_cents)::integer as amount_cents
        from public.change_order_items as item
        join public.change_orders as change_order on change_order.id = item.change_order_id
        where item.billed_invoice_id = invoice.id
          and item.applied_effect in ('draft', 'revision', 'unbilled', 'supplemental')
          and change_order.status = 'approved'
        group by change_order.number
      ) as grouped
    ), '[]'::jsonb)
  )
  from public.invoices as invoice
  where invoice.preview_token = p_token
  limit 1;
$function$;

revoke all on function public.get_invoice_adjustments_by_link(uuid) from public;
grant execute on function public.get_invoice_adjustments_by_link(uuid) to anon, authenticated, service_role;
