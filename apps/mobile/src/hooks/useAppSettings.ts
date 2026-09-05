import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { AppSettings } from '../types/database';

const FALLBACK: AppSettings = {
  id: true,
  registration_fee_inr: 300,
  referral_bonus_inr: 50,
  min_referral_withdrawal_inr: 150,
  upi_id: '',
  upi_payee_name: 'ReelSpark',
  updated_at: '',
};

// The single public.app_settings row (registration fee, referral bonus, UPI id).
export function useAppSettings() {
  const query = useQuery({
    queryKey: ['appSettings'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').eq('id', true).single();
      if (error) throw error;
      return data as AppSettings;
    },
  });

  return { ...query, settings: query.data ?? FALLBACK };
}
