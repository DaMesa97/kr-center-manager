-- 2026-10-21 (zwiad #5): zabezpieczenie logowania.
--
-- log_login_attempt był SECURITY DEFINER z EXECUTE dla anon i ufał parametrom:
--  * każdy (bez logowania) mógł wpisać "udane logowanie" dowolnego konta —
--    to kasowało nieudane próby z 15 min, czyli zerowało blokadę po 5 próbach
--    (brute force bez limitu),
--  * każdy mógł zasypać tabelę dowolnymi e-mailami.
-- Teraz:
--  * sukces przyjmowany tylko od ZALOGOWANEGO i tylko dla jego własnego e-maila
--    (klient woła RPC po signInWithPassword, już z sesją),
--  * porażka tylko dla istniejących kont i max 20 wpisów na konto w oknie 15 min,
--  * user_agent przycięty, e-mail max 254 znaki.
-- Wywołanie spoza reguł jest cicho ignorowane (klient i tak nie czyta wyniku).

CREATE OR REPLACE FUNCTION public.log_login_attempt(p_email text, p_success boolean, p_user_agent text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_own_email text;
begin
  if v_email = '' or length(v_email) > 254 then
    return;
  end if;

  if p_success then
    if auth.uid() is null then
      return;
    end if;
    select lower(u.email) into v_own_email from auth.users u where u.id = auth.uid();
    if v_own_email is distinct from v_email then
      return;
    end if;
  else
    if not exists (select 1 from auth.users u where lower(u.email) = v_email) then
      return;
    end if;
    if (select count(*) from login_attempts
        where email = v_email and success = false and attempted_at >= now() - interval '15 minutes') >= 20 then
      return;
    end if;
  end if;

  insert into login_attempts(email, success, user_agent)
  values (v_email, p_success, left(p_user_agent, 300));

  -- Po udanym logowaniu usuń wcześniejsze nieudane dla tego e-maila
  if p_success then
    delete from login_attempts
    where email = v_email
      and success = false
      and attempted_at >= now() - interval '15 minutes';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.log_login_attempt(text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_login_attempt(text, boolean, text) TO anon, authenticated, service_role;
