-- Switch registration payments from the manual UPI/QR + screenshot flow to
-- Razorpay Checkout, and make the fee a real ANNUAL membership:
--   * an order is created server-side (razorpay-create-order edge function),
--     the user pays in the Razorpay widget, and the payment signature is
--     verified server-side (razorpay-verify-payment + razorpay-webhook edge
--     functions) before the registration is approved
--   * approval sets profiles.paid_until = now() + 1 year; posting is gated on
--     an ACTIVE membership (approved AND paid_until in the future), so access
--     lapses automatically after 12 months and a fresh payment renews it
--   * closes a privilege-escalation hole: profiles' column-blind self-update
--     RLS let any signed-in user PATCH their own payment_status to 'approved'
-- Re-applies 0007 (which 0010 reverted) with the annual model layered on.
-- Run once in the Supabase SQL Editor (or `supabase db push`) after 0012.

-- =========================================================
-- app_settings — add the publishable Razorpay key id.
-- upi_id / upi_payee_name are kept (still returned by `select *` and still
-- describe the referral-withdrawal payout destination) — just unused by checkout.
-- =========================================================
alter table public.app_settings
  add column if not exists razorpay_key_id text not null default '';

-- =========================================================
-- registration_payments — Razorpay identifiers + a pre-payment 'created' state
-- =========================================================
alter table public.registration_payments
  add column if not exists razorpay_order_id text,
  add column if not exists razorpay_payment_id text,
  add column if not exists razorpay_signature text;

alter table public.registration_payments drop constraint if exists registration_payments_status_check;
alter table public.registration_payments
  add constraint registration_payments_status_check
  check (status in ('created', 'submitted', 'approved', 'rejected'));

create index if not exists registration_payments_rzp_order_idx
  on public.registration_payments (razorpay_order_id);

-- upi_reference / screenshot_path stay nullable for legacy rows; the Razorpay
-- flow never writes them.

-- =========================================================
-- profiles — annual membership expiry
-- =========================================================
alter table public.profiles
  add column if not exists paid_until timestamptz;

-- Don't lock out anyone already approved when this ships: give them a year from
-- now. (Admins/moderators are also unaffected via the is_admin() bypass below.)
update public.profiles
  set paid_until = now() + interval '1 year'
  where payment_status = 'approved' and paid_until is null;

-- =========================================================
-- has_active_membership — the single source of truth for "can this user post".
-- Active ≡ payment approved AND still inside the paid period. Expiry is derived,
-- not stored: an expired user keeps payment_status = 'approved' but paid_until
-- moves into the past, and the app shows a "renew" state.
-- =========================================================
create or replace function public.has_active_membership(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select payment_status = 'approved'
        and paid_until is not null
        and paid_until > now()
       from public.profiles
      where id = p_uid),
    false);
$$;

grant execute on function public.has_active_membership(uuid) to authenticated;

-- =========================================================
-- check_can_post — gate video INSERTs on an active membership (was: a bare
-- payment_status = 'approved' check). Admin bypass unchanged.
-- =========================================================
create or replace function public.check_can_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if not public.has_active_membership(new.submitted_by) then
    raise exception 'Your ReelSpark membership must be active before you can post videos.';
  end if;

  return new;
end;
$$;

-- =========================================================
-- guard_profile_privileged_columns — also block a non-admin app user from
-- self-editing payment_status / paid_until (the RLS policy on profiles only
-- checks row ownership, not which columns changed). SQL Editor / migrations
-- (auth.uid() null) and admins stay unaffected, so the RPCs below still work.
-- =========================================================
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role
      or new.is_banned is distinct from old.is_banned
      or new.banned_reason is distinct from old.banned_reason
      or new.banned_at is distinct from old.banned_at
      or new.payment_status is distinct from old.payment_status
      or new.paid_until is distinct from old.paid_until
    then
      raise exception 'Only admins can change role, ban or membership status.';
    end if;
  end if;
  return new;
end;
$$;

-- =========================================================
-- start_razorpay_payment — called by the razorpay-create-order edge function
-- (service role only). Records a pending attempt tied to the Razorpay order.
-- Reuses a still-'created' row < 15 min old for the same user so an abandoned
-- Checkout doesn't spawn a fresh row on every retry.
-- =========================================================
create or replace function public.start_razorpay_payment(
  p_user_id uuid,
  p_amount_inr integer,
  p_order_id text
)
returns public.registration_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.registration_payments;
begin
  select * into v_row
  from public.registration_payments
  where user_id = p_user_id
    and status = 'created'
    and created_at > now() - interval '15 minutes'
  order by created_at desc
  limit 1;

  if found then
    update public.registration_payments
    set amount_inr = p_amount_inr,
        razorpay_order_id = p_order_id
    where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into public.registration_payments (user_id, amount_inr, status, razorpay_order_id)
  values (p_user_id, p_amount_inr, 'created', p_order_id)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.start_razorpay_payment(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.start_razorpay_payment(uuid, integer, text) to service_role;

-- =========================================================
-- confirm_razorpay_payment — called by the razorpay-verify-payment edge
-- function (client callback path) and the razorpay-webhook edge function
-- (authoritative path), both service role only, after the HMAC check has
-- passed. Approves the attempt, extends the annual membership, unlocks posting
-- and credits the referral bonus (once, only on the user's FIRST approved
-- payment). Idempotent: a repeat call for an already-approved order is a no-op.
-- =========================================================
create or replace function public.confirm_razorpay_payment(
  p_order_id text,
  p_payment_id text,
  p_signature text
)
returns public.registration_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.registration_payments;
  v_referrer uuid;
  v_bonus integer;
begin
  select * into v_pay
  from public.registration_payments
  where razorpay_order_id = p_order_id
  for update;

  if not found then
    raise exception 'No payment attempt for Razorpay order %', p_order_id;
  end if;

  if v_pay.status = 'approved' then
    return v_pay;
  end if;

  update public.registration_payments
  set status = 'approved',
      razorpay_payment_id = p_payment_id,
      razorpay_signature = p_signature,
      reviewed_at = now()
  where id = v_pay.id
  returning * into v_pay;

  -- Renew from the later of the current expiry or now, so paying early extends
  -- rather than truncating the paid period.
  update public.profiles
  set payment_status = 'approved',
      paid_until = greatest(coalesce(paid_until, now()), now()) + interval '1 year'
  where id = v_pay.user_id;

  -- Referral bonus: once per referred user, on their first approved payment only
  -- (a renewal must not pay the referrer again).
  select referred_by into v_referrer from public.profiles where id = v_pay.user_id;
  if v_referrer is not null
     and not exists (select 1 from public.referral_earnings where payment_id = v_pay.id)
     and not exists (
       select 1 from public.registration_payments
       where user_id = v_pay.user_id and status = 'approved' and id <> v_pay.id
     )
  then
    select referral_bonus_inr into v_bonus from public.app_settings where id = true;
    v_bonus := coalesce(v_bonus, 50);

    insert into public.referral_earnings (referrer_id, referred_user_id, payment_id, amount_inr)
    values (v_referrer, v_pay.user_id, v_pay.id, v_bonus);

    update public.profiles
    set referral_balance_inr = referral_balance_inr + v_bonus
    where id = v_referrer;
  end if;

  return v_pay;
end;
$$;

revoke all on function public.confirm_razorpay_payment(text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_razorpay_payment(text, text, text) to service_role;

-- =========================================================
-- approve_registration_payment — admin manual override (missed webhook, etc.).
-- Same as 0006 plus the annual paid_until extension and the "first approved
-- payment only" referral guard, to match confirm_razorpay_payment.
-- =========================================================
create or replace function public.approve_registration_payment(
  p_payment_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_pay public.registration_payments;
  v_referrer uuid;
  v_bonus integer;
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'Only admins can approve payments.';
  end if;

  select * into v_pay from public.registration_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found.';
  end if;

  update public.registration_payments
  set status = 'approved',
      reviewed_by = v_admin,
      reviewed_at = now(),
      admin_note = nullif(trim(p_note), '')
  where id = p_payment_id;

  update public.profiles
  set payment_status = 'approved',
      paid_until = greatest(coalesce(paid_until, now()), now()) + interval '1 year'
  where id = v_pay.user_id;

  select referred_by into v_referrer from public.profiles where id = v_pay.user_id;
  if v_referrer is not null
     and not exists (select 1 from public.referral_earnings where payment_id = p_payment_id)
     and not exists (
       select 1 from public.registration_payments
       where user_id = v_pay.user_id and status = 'approved' and id <> p_payment_id
     )
  then
    select referral_bonus_inr into v_bonus from public.app_settings where id = true;
    v_bonus := coalesce(v_bonus, 50);

    insert into public.referral_earnings (referrer_id, referred_user_id, payment_id, amount_inr)
    values (v_referrer, v_pay.user_id, p_payment_id, v_bonus);

    update public.profiles
    set referral_balance_inr = referral_balance_inr + v_bonus
    where id = v_referrer;
  end if;

  insert into public.admin_actions (admin_id, action_type, target_table, target_id, notes)
  values (v_admin, 'approve_payment', 'registration_payments', p_payment_id, nullif(trim(p_note), ''));
end;
$$;

grant execute on function public.approve_registration_payment(uuid, text) to authenticated;

-- =========================================================
-- reject_registration_payment — admin manual override / refund bookkeeping.
-- Same as 0006 plus: revoke the paid period (paid_until = null) when the user
-- isn't already approved from a newer payment.
-- =========================================================
create or replace function public.reject_registration_payment(
  p_payment_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_pay public.registration_payments;
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'Only admins can reject payments.';
  end if;

  select * into v_pay from public.registration_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found.';
  end if;

  update public.registration_payments
  set status = 'rejected',
      reviewed_by = v_admin,
      reviewed_at = now(),
      admin_note = nullif(trim(p_note), '')
  where id = p_payment_id;

  -- Revoke access (refund path) unless the user still has another approved
  -- payment — e.g. they already renewed, or an earlier year is still on file.
  update public.profiles
  set payment_status = 'rejected',
      paid_until = null
  where id = v_pay.user_id
    and not exists (
      select 1 from public.registration_payments
      where user_id = v_pay.user_id and status = 'approved' and id <> p_payment_id
    );

  insert into public.admin_actions (admin_id, action_type, target_table, target_id, notes)
  values (v_admin, 'reject_payment', 'registration_payments', p_payment_id, nullif(trim(p_note), ''));
end;
$$;

grant execute on function public.reject_registration_payment(uuid, text) to authenticated;

-- =========================================================
-- Drop the manual-submit RPC — the app no longer calls it. Admin approve /
-- reject RPCs stay for manual overrides.
-- =========================================================
drop function if exists public.submit_registration_payment(text, text);
