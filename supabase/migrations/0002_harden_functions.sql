-- Advisor fixes: anon cannot call app_role(); trigger function has a fixed search_path.
-- authenticated keeps EXECUTE on app_role(): it only returns the caller's own role and RLS policies need it.
revoke execute on function public.app_role() from anon;
alter function public.rule_config_immutable() set search_path = public;
revoke execute on function public.save_rule_config(jsonb) from anon;
