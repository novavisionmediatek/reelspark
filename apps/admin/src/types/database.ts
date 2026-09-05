export type Platform = 'youtube' | 'instagram';
export type VideoStatus = 'pending' | 'approved' | 'rejected' | 'flagged';
export type ReportStatus = 'open' | 'reviewed' | 'dismissed';
export type PaymentStatus = 'unpaid' | 'submitted' | 'approved' | 'rejected';
export type RegistrationPaymentStatus = 'submitted' | 'approved' | 'rejected';
export type ReferralWithdrawalStatus = 'paid' | 'failed' | 'reversed';

export interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  instagram_handle: string | null;
  youtube_handle: string | null;
  avatar_url: string | null;
  bio: string | null;
  role: 'user' | 'moderator' | 'admin';
  is_banned: boolean;
  banned_reason: string | null;
  banned_at: string | null;
  payment_status: PaymentStatus;
  referral_code: string;
  referred_by: string | null;
  referral_balance_inr: number;
  created_at: string;
  updated_at: string;
}

export interface RegistrationPayment {
  id: string;
  user_id: string;
  amount_inr: number;
  upi_reference: string | null;
  screenshot_path: string | null;
  status: RegistrationPaymentStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  // joined
  user?: Pick<Profile, 'id' | 'display_name' | 'email' | 'referred_by'> | null;
}

export interface ReferralEarning {
  id: string;
  referrer_id: string;
  referred_user_id: string;
  payment_id: string;
  amount_inr: number;
  created_at: string;
}

export interface ReferralWithdrawal {
  id: string;
  user_id: string;
  amount_inr: number;
  upi_id: string;
  status: ReferralWithdrawalStatus;
  reference: string | null;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  user?: Pick<Profile, 'id' | 'display_name' | 'email' | 'referral_code' | 'referral_balance_inr'> | null;
}

export interface AppSettings {
  id: boolean;
  registration_fee_inr: number;
  referral_bonus_inr: number;
  min_referral_withdrawal_inr: number;
  upi_id: string;
  upi_payee_name: string;
  updated_at: string;
}

export interface Video {
  id: string;
  submitted_by: string;
  platform: Platform;
  original_url: string;
  platform_video_id: string;
  canonical_url: string | null;
  thumbnail_url: string | null;
  title: string | null;
  author_name: string | null;
  status: VideoStatus;
  rejection_reason: string | null;
  moderated_by: string | null;
  moderated_at: string | null;
  view_count_in_app: number;
  report_count: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Report {
  id: string;
  video_id: string;
  reported_by: string;
  reason: 'broken_link' | 'spam' | 'inappropriate' | 'not_own_content' | 'other';
  notes: string | null;
  status: ReportStatus;
  created_at: string;
}
