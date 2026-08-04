insert into public.service_settings (organization_id)
select organization.id
from public.organizations as organization
where organization.archived_at is null
on conflict (organization_id) do nothing;
