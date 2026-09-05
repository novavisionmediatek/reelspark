-- Replace Razorpay Checkout with the manual UPI QR flow: the app shows a QR
-- code (generated client-side from app_settings.upi_id) + the UPI ID as text,
-- the user pays with any UPI app, then submits their UTR/reference number and
-- a screenshot of the payment for an admin to verify. Fully reverts 0007 —
-- there's no live Razorpay traffic to preserve, so this drops its columns and
-- functions rather than leaving dead ones around. Run once after 0009.

-- =========================================================
-- app_settings — drop the Razorpay key id, restore the UPI destination
-- =========================================================
alter table public.app_settings
  drop column if exists razorpay_key_id,
  add column if not exists upi_id text not null default 'reelspark.in@okhdfcbank',
  add column if not exists upi_payee_name text not null default 'ReelSpark';

-- =========================================================
-- registration_payments — drop Razorpay identifiers + the pre-payment
-- 'created' state (nothing to create up front in the manual flow)
-- =========================================================
alter table public.registration_payments
  drop column if exists razorpay_order_id,
  drop column if exists razorpay_payment_id,
  drop column if exists razorpay_signature;

update public.registration_payments set status = 'rejected' where status = 'created';

alter table public.registration_payments drop constraint if exists registration_payments_status_check;
alter table public.registration_payments
  add constraint registration_payments_status_check
  check (status in ('submitted', 'approved', 'rejected'));

-- upi_reference/screenshot_path stay nullable at the column level (old Razorpay
-- rows have neither) — the RPC below requires both for every new submission.

-- =========================================================
-- Drop the Razorpay-only RPCs (service-role only; nothing else calls them)
-- =========================================================
drop function if exists public.start_razorpay_payment(uuid, integer, text);
drop function if exists public.confirm_razorpay_payment(text, text, text);

-- =========================================================
-- submit_registration_payment — re-created (dropped in 0007). Called by the
-- app once the user has paid and has both a UTR/reference and a screenshot.
-- =========================================================
create function public.submit_registration_payment(
  p_upi_reference text,
  p_screenshot_path text
)
returns public.registration_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_fee integer;
  v_row public.registration_payments;
begin
  if v_uid is null then
    raise exception 'Not authenticated.';
  end if;

  if nullif(trim(p_upi_reference), '') is null then
    raise exception 'A UTR / transaction reference is required.';
  end if;
  if nullif(trim(p_screenshot_path), '') is null then
    raise exception 'A payment screenshot is required.';
  end if;

  select payment_status into v_status from public.profiles where id = v_uid;
  if v_status = 'approved' then
    raise exception 'Your registration is already approved.';
  end if;

  select registration_fee_inr into v_fee from public.app_settings where id = true;

  insert into public.registration_payments (user_id, amount_inr, upi_reference, screenshot_path, status)
  values (v_uid, coalesce(v_fee, 300), trim(p_upi_reference), trim(p_screenshot_path), 'submitted')
  returning * into v_row;

  update public.profiles set payment_status = 'submitted' where id = v_uid;

  return v_row;
end;
$$;

grant execute on function public.submit_registration_payment(text, text) to authenticated;
