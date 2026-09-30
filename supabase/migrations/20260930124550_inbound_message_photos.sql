-- Existing messages RLS also protects photo references. Credentials are never stored here.
alter table public.messages add column if not exists media jsonb not null default '[]'::jsonb;
alter table public.messages add constraint messages_media_array check (jsonb_typeof(media)='array' and jsonb_array_length(media)<=10);
-- Only the signed server webhook may attach provider media references.
create function public.protect_message_media() returns trigger language plpgsql set search_path='' as $$
begin
 if coalesce(current_setting('role',true),'') in ('anon','authenticated') then
   if (TG_OP='INSERT' and NEW.media <> '[]'::jsonb) or
      (TG_OP='UPDATE' and (NEW.media is distinct from OLD.media or
        (OLD.media <> '[]'::jsonb and (NEW.provider_message_id is distinct from OLD.provider_message_id or NEW.organization_id is distinct from OLD.organization_id)))) then
     raise exception using errcode='42501',message='Provider media is server managed';
   end if;
 end if;
 return NEW;
end;
$$;
create trigger protect_message_media before insert or update on public.messages for each row execute function public.protect_message_media();
