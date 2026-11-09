-- Pia ist die einzige Admin: nur sie kann PINs zurücksetzen, die Verwaltung in den
-- Einstellungen nutzen und fremde Treffen bearbeiten.
-- (Die Übersicht "Ausgaben aller" sehen weiterhin Dieter und Gudrun – das regelt die App
--  über die Gruppe "Eltern", nicht über is_admin.)
-- Im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.

update public.profiles set is_admin = (name = 'Pia') where not is_group;

create or replace function public.admin_reset_pin(person text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_auth uuid;
begin
    if not public.is_admin() then
        raise exception 'Nur Pia darf PINs zurücksetzen';
    end if;
    select auth_id into v_auth from public.profiles where name = person;
    if v_auth is not null then
        delete from auth.users where id = v_auth;
    end if;
end $$;
revoke execute on function public.admin_reset_pin(text) from public, anon;
grant execute on function public.admin_reset_pin(text) to authenticated;

select name, is_admin from public.profiles where not is_group order by sort_order;
