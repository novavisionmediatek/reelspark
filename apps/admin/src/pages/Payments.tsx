import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Badge, Btn, DetailEmpty, Field, ListRow, ListState, WorkPage } from '../components/ui';
import type { RegistrationPayment, RegistrationPaymentStatus } from '../types/database';

const FILTERS: { label: string; value: RegistrationPaymentStatus | 'all' }[] = [
  { label: 'Submitted', value: 'submitted' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'All', value: 'all' },
];

export function Payments() {
  const [filter, setFilter] = useState<RegistrationPaymentStatus | 'all'>('submitted');
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));
  const queryClient = useQueryClient();

  const { data: payments, isLoading } = useQuery({
    queryKey: ['adminPayments', filter],
    queryFn: async () => {
      let query = supabase
        .from('registration_payments')
        .select('*, user:profiles!registration_payments_user_id_fkey (id, display_name, email, referred_by)')
        .order('created_at', { ascending: false });
      if (filter !== 'all') query = query.eq('status', filter);
      const { data, error } = await query;
      if (error) throw error;
      return data as RegistrationPayment[];
    },
  });

  const selected = payments?.find((p) => p.id === selectedId) ?? null;

  const { data: screenshotUrl } = useQuery({
    queryKey: ['paymentScreenshot', selected?.screenshot_path],
    enabled: !!selected?.screenshot_path,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from('payment-proofs')
        .createSignedUrl(selected!.screenshot_path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  const review = useMutation({
    mutationFn: async ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => {
      const { error } = await supabase.rpc(approve ? 'approve_registration_payment' : 'reject_registration_payment', {
        p_payment_id: id,
        p_note: note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminPayments'] });
    },
  });

  function select(id: string | null) {
    setSelectedId(id);
    setSearchParams(id ? { id } : {}, { replace: true });
  }

  const list = (
    <>
      <div className="sticky top-0 bg-bg border-b border-border px-3 py-2 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
              filter === f.value ? 'bg-surface text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <ListState>Loading…</ListState>
      ) : !payments || payments.length === 0 ? (
        <ListState>Nothing here.</ListState>
      ) : (
        payments.map((p) => (
          <ListRow
            key={p.id}
            selected={p.id === selectedId}
            onClick={() => select(p.id)}
            title={<span className="font-mono">₹{p.amount_inr}</span>}
            subtitle={p.user?.display_name ?? p.user?.email ?? p.user_id}
            right={<Badge value={p.status} />}
          />
        ))
      )}
    </>
  );

  const detail = !selected ? (
    <DetailEmpty label="Select a payment to review." />
  ) : (
    <div className="p-4 sm:p-6 max-w-2xl">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display font-semibold text-base">
            {selected.user?.display_name ?? selected.user?.email ?? selected.user_id}
          </h2>
          <p className="text-text-muted text-xs mt-0.5 truncate">{selected.user?.email}</p>
        </div>
        <Badge value={selected.status} />
      </div>

      <div className="mt-5">
        <Field label="Amount" mono>
          ₹{selected.amount_inr}
        </Field>
        <Field label="UTR / reference" mono>
          {selected.upi_reference ?? '—'}
        </Field>
        <Field label="Submitted" mono>
          {new Date(selected.created_at).toLocaleString()}
        </Field>
        {selected.reviewed_at && (
          <Field label="Reviewed" mono>
            {new Date(selected.reviewed_at).toLocaleString()}
          </Field>
        )}
        <Field label="Referred">
          {selected.user?.referred_by ? 'Yes — referrer earns the bonus on approval.' : 'No.'}
        </Field>
        {selected.admin_note && <Field label="Note">{selected.admin_note}</Field>}
        {selected.screenshot_path && (
          <Field label="Screenshot">
            {screenshotUrl ? (
              <a href={screenshotUrl} target="_blank" rel="noreferrer">
                <img src={screenshotUrl} alt="Payment screenshot" className="max-w-full rounded-md border border-border mt-1" />
              </a>
            ) : (
              <span className="text-text-muted">Loading…</span>
            )}
          </Field>
        )}
      </div>

      {review.isError && <p className="text-coral text-sm mt-4">{(review.error as Error)?.message}</p>}

      {selected.status === 'submitted' && (
        <div className="flex flex-wrap gap-2 mt-5">
          <Btn variant="approve" onClick={() => review.mutate({ id: selected.id, approve: true })} disabled={review.isPending}>
            Approve
          </Btn>
          <Btn
            variant="reject"
            disabled={review.isPending}
            onClick={() => {
              const note = window.prompt('Rejection reason (shown to the creator):');
              if (note !== null) review.mutate({ id: selected.id, approve: false, note });
            }}
          >
            Reject
          </Btn>
        </div>
      )}
    </div>
  );

  return (
    <WorkPage
      title="Payments"
      description="Registration payments paid via UPI — verify the UTR against your bank/UPI app and the screenshot before approving."
      list={list}
      detail={detail}
      selected={!!selected}
      onBack={() => select(null)}
    />
  );
}
