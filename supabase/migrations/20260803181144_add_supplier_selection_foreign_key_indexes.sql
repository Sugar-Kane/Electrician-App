create index supplier_product_selections_job_id_idx
on public.supplier_product_selections(job_id)
where job_id is not null;

create index supplier_product_selections_verified_by_idx
on public.supplier_product_selections(verified_by)
where verified_by is not null;
