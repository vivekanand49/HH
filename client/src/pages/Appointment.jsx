import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '../components/Icon';
import { ErrorNote, Loading, PageTitle, StaleNote } from '../components/ui';
import { api, useCachedApi } from '../lib/api';
import { deptLabel } from '../lib/labels';
import { payAtCounter, payForAppointment } from '../lib/payments';
import { formatDateTime } from '../i18n';

export default function Appointment() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const justBooked = useLocation().state?.justBooked;
  const { data, loading, error, stale, savedAt, reload } = useCachedApi(`/appointments/${id}`);
  const [cancelError, setCancelError] = useState(null);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState('upi');
  const a = data?.appointment;

  async function cancel() {
    if (!window.confirm(t('Cancel this appointment?'))) return;
    try {
      await api(`/appointments/${id}/cancel`, { method: 'POST' });
      navigate('/', { replace: true });
    } catch (err) {
      setCancelError(err);
    }
  }

  async function pay() {
    setPaying(true);
    setCancelError(null);
    try {
      if (method === 'counter') {
        await payAtCounter(a);
        await reload();
        return;
      }
      const done = await payForAppointment(a, {
        method,
        description: `${a.doctor_name} · ${a.hospital_name}`,
        confirmMock: (amount) => Promise.resolve(window.confirm(t('Demo payment: pay ₹{{amount}}? No real money is charged.', { amount }))),
      });
      if (done) await reload();
    } catch (err) {
      setCancelError(err);
    } finally {
      setPaying(false);
    }
  }

  if (loading && !a) return <Loading />;
  if (!a) return <ErrorNote error={error} onRetry={reload} />;

  const live = a.status === 'confirmed' || a.status === 'pending_payment';
  const rows = [
    [t('Hospital'), a.hospital_name],
    [t('Doctor'), a.doctor_name],
    [t('Department'), deptLabel(a.department)],
    [t('Room'), a.room ?? '-'],
    [t('Visit'), a.visit_type === 'video' ? t('Video consult') : t('At the hospital')],
    [
      t('Fee'),
      a.fee_inr
        ? `₹${a.fee_inr}${a.payment_status === 'paid' ? ` · ${t('Payment done')}` : a.payment_status === 'at_counter' ? ` · ${t('Pay at counter')}` : ''}`
        : t('Free (Government)'),
    ],
  ];
  // Online methods open Razorpay on that method; the counter is for in-person visits only.
  const METHODS = [
    { key: 'upi', icon: 'upi', label: t('UPI (Google Pay / PhonePe)') },
    { key: 'card', icon: 'card', label: t('Card') },
    { key: 'netbanking', icon: 'bank', label: t('Net banking') },
    ...(a.visit_type === 'in_person'
      ? [{ key: 'counter', icon: 'cash', label: t('Cash / UPI at hospital counter'), hint: t('Pay when you arrive. No internet needed.') }]
      : []),
  ];

  return (
    <div className="mx-auto max-w-xl">
      {justBooked ? (
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-leaf-dark text-white">
            <Icon name="check" size={34} strokeWidth={3} />
          </span>
          <h1 className="text-[28px] font-bold">{a.status === 'pending_payment' ? t('Slot held — payment pending') : t('Appointment booked')}</h1>
          <p className="text-muted">{t('SMS sent to you and to the hospital')}</p>
        </div>
      ) : (
        <PageTitle title={t('Appointment')} back="/" />
      )}
      <StaleNote stale={stale} savedAt={savedAt} />
      <ErrorNote error={cancelError} />

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between bg-brand-soft p-4 text-brand-dark">
          <span>
            <span className="block text-xs font-bold tracking-wide">{t('OPD TOKEN')}</span>
            <span className="font-display text-4xl font-bold">{a.token}</span>
          </span>
          <span className="text-right font-semibold">
            <span className="block">{formatDateTime(a.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <span>{formatDateTime(a.starts_at, { hour: 'numeric', minute: '2-digit' })}</span>
          </span>
        </div>
        {a.doctor_photo && (
          <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
            <img src={a.doctor_photo} alt="" width={56} height={56} className="size-14 rounded-full object-cover ring-2 ring-brand-soft" />
            <span className="min-w-0">
              <span className="block truncate font-bold">{a.doctor_name}</span>
              <span className="block text-sm text-muted">
                {deptLabel(a.department)} · {a.hospital_name}
              </span>
            </span>
          </div>
        )}
        <dl className="flex flex-col gap-3 p-4 text-[15px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
          {a.status === 'cancelled' && <p className="font-semibold text-sos-dark">{t('Cancelled')}</p>}
        </dl>
      </div>

      {a.status === 'pending_payment' && (
        <section className="card mt-4 flex flex-col gap-3 p-4" aria-labelledby="pay-title">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="pay-title" className="text-lg font-bold">
              {t('Choose payment method')}
            </h2>
            <span className="font-display text-2xl font-bold text-brand">₹{a.fee_inr}</span>
          </div>
          <p className="-mt-2 text-sm font-semibold text-brand-dark">{t('Pay within 15 minutes to keep this time.')}</p>
          <div role="radiogroup" aria-labelledby="pay-title" className="flex flex-col gap-2">
            {METHODS.map((m) => {
              const on = method === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setMethod(m.key)}
                  className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-3.5 py-2.5 text-left ${on ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}
                >
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${on ? 'bg-brand text-white' : 'bg-bg text-brand'}`}>
                    <Icon name={m.icon} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{m.label}</span>
                    {m.hint && <span className="block text-sm text-muted">{m.hint}</span>}
                  </span>
                  <span className={`grid size-6 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-brand' : 'border-line'}`} aria-hidden="true">
                    {on && <span className="size-3 rounded-full bg-brand" />}
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" className="btn-primary min-h-14 text-lg shadow-lg shadow-brand/25" onClick={pay} disabled={paying}>
            {paying ? t('Please wait…') : method === 'counter' ? t('Confirm — I will pay at the counter') : t('Pay now ₹{{fee}}', { fee: a.fee_inr })}
          </button>
          <p className="flex items-center justify-center gap-1.5 text-sm text-muted">
            <Icon name="shield" size={16} /> {t('Safe and secure payments')}
          </p>
        </section>
      )}

      {a.payment_status === 'at_counter' && a.status === 'confirmed' && (
        <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-warn-soft p-3.5 text-[15px] text-warn">
          <Icon name="cash" size={20} /> {t('Please pay ₹{{fee}} at the hospital counter when you arrive. Show your token.', { fee: a.fee_inr })}
        </p>
      )}

      {a.visit_type === 'video' && a.status === 'confirmed' && (
        <Link to={`/consult/${a.id}`} className="btn-primary mt-4 min-h-14 w-full text-lg">
          <Icon name="video" /> {t('Join video consult')}
        </Link>
      )}

      {a.status === 'completed' && a.diagnosis && (
        <div className="card mt-4 p-4">
          <p className="text-sm font-bold text-muted uppercase">{t('Doctor’s note')}</p>
          <p className="mt-1">{a.diagnosis}</p>
          <Link to="/records" className="mt-2 inline-block font-semibold text-brand">
            {t('See prescription in records')}
          </Link>
        </div>
      )}

      <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-brand-soft p-3.5 text-[15px] text-brand-dark">
        <Icon name="shield" size={20} /> {t('Saved on your phone. Show this screen at the counter, even without internet.')}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <a className="btn-outline" href={`https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`} target="_blank" rel="noreferrer">
          <Icon name="pin" size={18} /> {t('Directions')}
        </a>
        {live && (
          <button type="button" className="btn-outline" onClick={cancel}>
            {t('Cancel')}
          </button>
        )}
      </div>
      <Link to="/" className="btn-primary mt-3 w-full">
        {t('Back to home')}
      </Link>
    </div>
  );
}
