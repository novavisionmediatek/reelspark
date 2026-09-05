import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthProvider';
import type { RegistrationPayment } from '../types/database';

// The current user's most recent registration payment attempt. While it's still
// pending we poll so an approval shows up without a manual reload.
export function useRegistrationPayment() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ['registrationPayment', userId],
    enabled: !!userId,
    refetchInterval: (query) => {
      const status = (query.state.data as RegistrationPayment | null)?.status;
      return status === 'submitted' ? 15000 : false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registration_payments')
        .select('*')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as RegistrationPayment | null) ?? null;
    },
  });
}

interface SubmitPaymentInput {
  utr: string;
  screenshotUri: string;
}

// Uploads the payment screenshot to the private `payment-proofs` bucket, then
// records the UTR + screenshot for admin review via `submit_registration_payment`.
export function useSubmitRegistrationPayment() {
  const queryClient = useQueryClient();
  const { session, refreshProfile } = useAuth();

  return useMutation({
    mutationFn: async ({ utr, screenshotUri }: SubmitPaymentInput) => {
      const userId = session?.user.id;
      if (!userId) throw new Error('Not logged in.');

      const response = await fetch(screenshotUri);
      const arrayBuffer = await response.arrayBuffer();
      const path = `${userId}/${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('payment-proofs')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase.rpc('submit_registration_payment', {
        p_upi_reference: utr,
        p_screenshot_path: path,
      });
      if (error) throw error;
      return data as RegistrationPayment;
    },
    onSuccess: async () => {
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: ['registrationPayment', session?.user.id] });
    },
  });
}
