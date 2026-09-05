-- `reset_all_data()` truncated every public table but never touched
-- `auth.users`, so a wiped account's Supabase Auth user survived with no
-- matching profile. Signing up again with that email then fails with
-- "User already registered" even though the app shows no trace of the user.
-- Delete the stray Auth users too — `profiles.id references auth.users(id)
-- on delete cascade`, so this also mirrors what the truncate above already
-- did to that user's profile row (a no-op, since it's already gone).

create or replace function public.reset_all_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_email text;
begin
  if caller is null or not public.is_admin() then
    raise exception 'Only admins can reset the database.';
  end if;

  select email into caller_email from public.profiles where id = caller;

  truncate table
    public.admin_actions,
    public.referral_earnings,
    public.registration_payments,
    public.reports,
    public.videos,
    public.profiles
  restart identity cascade;

  delete from auth.users where id <> caller;

  insert into public.profiles (id, email, role, referral_code, payment_status)
  values (caller, caller_email, 'admin', public.gen_referral_code(), 'approved');
end;
$$;
