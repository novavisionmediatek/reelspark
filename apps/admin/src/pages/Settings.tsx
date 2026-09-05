import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PageHeader } from '../components/ui';
import type { AppSettings } from '../types/database';

const SECTION = 'border border-border rounded-md p-5 mb-4';

function RegistrationSettings() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['appSettings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').eq('id', true).single();
      if (error) throw error;
      return data as AppSettings;
    },
  });

  const [fee, setFee] = useState('300');
  const [bonus, setBonus] = useState('50');
  const [minWithdrawal, setMinWithdrawal] = useState('150');
  const [upiId, setUpiId] = useState('');
  const [upiPayeeName, setUpiPayeeName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setFee(String(data.registration_fee_inr));
    setBonus(String(data.referral_bonus_inr));
    setMinWithdrawal(String(data.min_referral_withdrawal_inr ?? 150));
    setUpiId(data.upi_id ?? '');
    setUpiPayeeName(data.upi_payee_name ?? '');
  }, [data]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const { error } = await supabase
      .from('app_settings')
      .update({
        registration_fee_inr: Math.max(0, parseInt(fee, 10) || 0),
        referral_bonus_inr: Math.max(0, parseInt(bonus, 10) || 0),
        min_referral_withdrawal_inr: Math.max(0, parseInt(minWithdrawal, 10) || 0),
        upi_id: upiId.trim(),
        upi_payee_name: upiPayeeName.trim(),
      })
      .eq('id', true);
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
    } else {
      setMsg({ ok: true, text: 'Saved.' });
      queryClient.invalidateQueries({ queryKey: ['appSettings'] });
    }
  }

  const field = 'w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm text-text outline-none focus:border-pink transition-colors';

  return (
    <section className={SECTION}>
      <h2 className="font-medium text-sm mb-1">Registration &amp; referral</h2>
      <p className="text-text-muted text-xs mb-4">
        The one-time fee new users pay, the bonus a referrer earns when their invitee is approved, and the UPI ID the
        app's payment QR code and text both point to. Users pay this directly and submit a UTR + screenshot for you
        to verify on the Payments page.
      </p>
      <form onSubmit={handleSave} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Registration fee (₹)</label>
            <input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} className={field} />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Referral bonus (₹)</label>
            <input type="number" min={0} value={bonus} onChange={(e) => setBonus(e.target.value)} className={field} />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Min. referral withdrawal (₹)</label>
            <input
              type="number"
              min={0}
              value={minWithdrawal}
              onChange={(e) => setMinWithdrawal(e.target.value)}
              className={field}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">UPI ID</label>
            <input
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="yourname@okhdfcbank"
              className={field}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">UPI payee name</label>
            <input
              value={upiPayeeName}
              onChange={(e) => setUpiPayeeName(e.target.value)}
              placeholder="ReelSpark"
              className={field}
            />
          </div>
        </div>
        {msg && <p className={`text-sm ${msg.ok ? 'text-purple-300' : 'text-coral'}`}>{msg.text}</p>}
        <button
          type="submit"
          disabled={busy}
          className="brand-gradient text-white font-semibold text-sm px-4 py-2.5 rounded-lg disabled:opacity-50 transition-opacity"
        >
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </section>
  );
}

export function Settings() {
  const queryClient = useQueryClient();

  // --- Add an admin -------------------------------------------------
  const [email, setEmail] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMsg, setAdminMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handlePromote(e: FormEvent) {
    e.preventDefault();
    setAdminMsg(null);
    setAdminBusy(true);
    const { error } = await supabase.rpc('promote_to_admin', { p_email: email.trim() });
    setAdminBusy(false);
    if (error) {
      setAdminMsg({ ok: false, text: error.message });
    } else {
      setAdminMsg({ ok: true, text: `${email.trim()} is now an admin.` });
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
    }
  }

  // --- Wipe all data ---------------------------------------------------
  const [confirmText, setConfirmText] = useState('');
  const [wipeBusy, setWipeBusy] = useState(false);
  const [wipeMsg, setWipeMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleWipe() {
    if (confirmText !== 'DELETE') return;
    if (!window.confirm('This permanently erases every row in every table. Continue?')) return;
    setWipeMsg(null);
    setWipeBusy(true);
    const { error } = await supabase.rpc('reset_all_data');
    setWipeBusy(false);
    setConfirmText('');
    if (error) {
      setWipeMsg({ ok: false, text: error.message });
    } else {
      setWipeMsg({ ok: true, text: 'All tables have been cleared.' });
      queryClient.invalidateQueries();
    }
  }

  return (
    <div>
      <PageHeader title="Settings" description="Registration, admins and database data." />
      <div className="p-4 sm:p-6 max-w-xl">
      <RegistrationSettings />

      {/* Add an admin */}
      <section className={SECTION}>
        <h2 className="font-medium text-sm mb-1">Add an admin</h2>
        <p className="text-text-muted text-xs mb-4">
          The person must have signed up in the ReelSpark app first. Enter their email to grant admin access.
        </p>
        <form onSubmit={handlePromote} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm text-text outline-none focus:border-pink transition-colors"
          />
          {adminMsg && (
            <p className={`text-sm ${adminMsg.ok ? 'text-purple-300' : 'text-coral'}`}>{adminMsg.text}</p>
          )}
          <button
            type="submit"
            disabled={adminBusy}
            className="brand-gradient text-white font-semibold text-sm px-4 py-2.5 rounded-lg disabled:opacity-50 transition-opacity"
          >
            {adminBusy ? 'Working…' : 'Make admin'}
          </button>
        </form>
      </section>

      {/* Danger zone */}
      <section className="border border-coral/40 rounded-md p-5">
        <h2 className="font-medium text-sm text-coral mb-1">Danger zone — wipe all data</h2>
        <p className="text-text-muted text-xs mb-4">
          Truncates every table (profiles, videos, reports, admin actions). Your own admin account is kept so you
          stay signed in; everything else is gone for good. This cannot be undone.
        </p>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
          Type <span className="text-text">DELETE</span> to confirm
        </label>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          className="w-full max-w-[200px] bg-bg border border-border rounded-lg px-3 py-2.5 text-sm text-text outline-none focus:border-coral transition-colors mb-3"
        />
        {wipeMsg && <p className={`text-sm mb-3 ${wipeMsg.ok ? 'text-purple-300' : 'text-coral'}`}>{wipeMsg.text}</p>}
        <div>
          <button
            onClick={handleWipe}
            disabled={wipeBusy || confirmText !== 'DELETE'}
            className="text-sm font-semibold px-4 py-2.5 rounded-lg bg-coral/20 text-red-300 border border-coral/50 hover:bg-coral/30 disabled:opacity-40 disabled:hover:bg-coral/20 transition-colors"
          >
            {wipeBusy ? 'Wiping…' : 'Wipe all data'}
          </button>
        </div>
      </section>
      </div>
    </div>
  );
}
