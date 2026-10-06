import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import Icon from '../components/Icon';
import { ChoiceCard, ErrorNote, Loading, PageTitle } from '../components/ui';
import { api, useCachedApi } from '../lib/api';
import { deptLabel, DEPARTMENTS, pick } from '../lib/labels';
import { getLocation } from '../lib/location';
import { formatDateTime } from '../i18n';

const STEPS = ['Hospital type', 'Choose hospital', 'Department', 'Choose doctor', 'Date and time'];

export default function Book() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const visitType = params.get('visit') === 'video' ? 'video' : 'in_person';
  // A health worker booking for a villager: /book?for=<patientId>&name=<name>
  const forPatient = params.get('for');
  const forName = params.get('name');
  const user = useSelector((s) => s.session.user);

  const [step, setStep] = useState(0);
  const [type, setType] = useState(null);
  const [hospital, setHospital] = useState(null);
  const [dept, setDept] = useState(null);
  const [doctor, setDoctor] = useState(null);
  const [day, setDay] = useState(null);
  const [slot, setSlot] = useState(null);
  const [complaint, setComplaint] = useState('');
  const [q, setQ] = useState('');
  const [loc, setLoc] = useState(user?.lat != null ? { lat: user.lat, lng: user.lng } : null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getLocation({ timeout: 8000 }).then((l) => l && setLoc(l));
  }, []);

  const hospitalsPath = type ? `/hospitals?type=${type}${loc ? `&lat=${loc.lat}&lng=${loc.lng}` : ''}` : null;
  const hospitals = useCachedApi(step >= 1 ? hospitalsPath : null);
  const doctors = useCachedApi(step >= 3 && hospital && dept ? `/hospitals/${hospital.id}/doctors?department=${dept}` : null);
  const slots = useCachedApi(step >= 4 && doctor ? `/doctors/${doctor.id}/slots` : null);

  const days = useMemo(() => {
    const map = new Map();
    for (const s of slots.data?.slots ?? []) {
      const key = formatDateTime(s.starts_at, { year: 'numeric', month: '2-digit', day: '2-digit' });
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return [...map.entries()].map(([key, list]) => ({ key, first: list[0].starts_at, list }));
  }, [slots.data]);
  const activeDay = days.find((d) => d.key === day) ?? days[0];

  const hospitalList = (hospitals.data?.hospitals ?? []).filter((h) => `${h.name} ${h.area ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const ready = [type, hospital, dept, doctor, slot][step];
  const fee = doctor?.fee_inr ?? 0;

  async function confirm() {
    setBooking(true);
    setError(null);
    try {
      if (forPatient) {
        await api(`/hw/patients/${forPatient}/appointments`, { method: 'POST', body: { slotId: slot.id, complaint: complaint || undefined } });
        navigate('/worker', { replace: true });
        return;
      }
      const res = await api('/appointments', { method: 'POST', body: { slotId: slot.id, visitType, complaint: complaint || undefined } });
      navigate(`/appointments/${res.appointment.id}`, { replace: true, state: { justBooked: true } });
    } catch (err) {
      setError(err);
      if (err.status === 409) {
        setSlot(null);
        slots.reload();
      }
    } finally {
      setBooking(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title={
          forPatient ? t('Book for {{name}}', { name: forName || t('Patient') }) : visitType === 'video' ? t('Book a video consult') : t('Book an appointment')
        }
        subtitle={t('Step {{n}} of 5 · {{title}}', { n: step + 1, title: t(STEPS[step]) })}
        back={step === 0 ? (forPatient ? '/worker' : '/') : undefined}
        image={step === 0 ? (visitType === 'video' ? '/img/doctor-hero.jpg' : '/img/doctor-2.jpg') : undefined}
        imagePosition="50% 20%"
        action={
          step > 0 && (
            <button type="button" className="btn-outline min-h-11 px-4" onClick={() => setStep(step - 1)}>
              <Icon name="left" size={18} /> {t('Back')}
            </button>
          )
        }
      />
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={step + 1}>
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(step + 1) * 20}%` }} />
      </div>

      <ErrorNote error={error} />

      {step === 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          <ChoiceCard
            selected={type === 'government'}
            onClick={() => {
              setType('government');
              setHospital(null);
            }}
            className="p-5"
          >
            <span className="flex items-center justify-between">
              <span className="text-xl font-bold">{t('Government')}</span>
              <span className="rounded-full bg-leaf-soft px-3 py-1 text-sm font-bold text-leaf-dark">{t('Free')}</span>
            </span>
            <span className="mt-2 block text-[15px] text-muted">{t('Hospitals and health centres. Free or very low fee. Longer waiting time.')}</span>
          </ChoiceCard>
          <ChoiceCard
            selected={type === 'private'}
            onClick={() => {
              setType('private');
              setHospital(null);
            }}
            className="p-5"
          >
            <span className="flex items-center justify-between">
              <span className="text-xl font-bold">{t('Private')}</span>
              <span className="rounded-full bg-brand-soft px-3 py-1 text-sm font-bold text-brand">{t('Paid')}</span>
            </span>
            <span className="mt-2 block text-[15px] text-muted">{t('Consultation fee applies. Shorter waiting time.')}</span>
          </ChoiceCard>
          <Link to="/assistant" className="flex items-center gap-3 rounded-2xl bg-accent-soft p-4 text-[15px] text-accent-dark md:col-span-2">
            <Icon name="chat" /> {t('Not sure where to go? Describe your problem to the health assistant.')}
          </Link>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <label className="flex min-h-12 items-center gap-2.5 rounded-2xl border border-line bg-surface px-4">
            <Icon name="search" size={18} className="text-muted" />
            <span className="sr-only">{t('Search hospitals')}</span>
            <input
              className="flex-1 bg-transparent py-3 text-base outline-none"
              placeholder={t('Search hospital or area')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <p className="text-sm text-muted">{loc ? t('Nearest first') : t('Turn on location to see the nearest first')}</p>
          {hospitals.loading && !hospitals.data && <Loading />}
          <ErrorNote error={hospitals.error} onRetry={hospitals.reload} />
          <div className="grid gap-3 md:grid-cols-2">
            {hospitalList.map((h) => (
              <ChoiceCard
                key={h.id}
                selected={hospital?.id === h.id}
                onClick={() => {
                  setHospital(h);
                  setDept(null);
                  setDoctor(null);
                }}
              >
                <span className="flex justify-between gap-3">
                  <span className="text-[17px] leading-snug font-semibold">{h.name}</span>
                  <span className="font-bold whitespace-nowrap text-brand">{h.distance_km} km</span>
                </span>
                <span className="mt-1 block text-sm text-muted">{h.area}</span>
                <span className="mt-2 flex flex-wrap gap-1.5 text-[13px]">
                  {h.has_emergency && <span className="rounded-md bg-sos-soft px-2 py-1 font-semibold text-sos-dark">{t('Emergency 24×7')}</span>}
                  {h.beds_free > 0 && (
                    <span className="rounded-md bg-leaf-soft px-2 py-1 font-semibold text-leaf-dark">{t('{{n}} beds free', { n: h.beds_free })}</span>
                  )}
                  <span className="rounded-md bg-line-soft px-2 py-1">{t('{{n}} departments', { n: h.departments.length })}</span>
                </span>
              </ChoiceCard>
            ))}
          </div>
        </div>
      )}

      {step === 2 && hospital && (
        <div>
          <p className="mb-3 text-[15px] text-muted">{hospital.name}</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {hospital.departments.map((d) => (
              <ChoiceCard
                key={d}
                selected={dept === d}
                onClick={() => {
                  setDept(d);
                  setDoctor(null);
                }}
                className="min-h-24"
              >
                <span className="block leading-snug font-semibold">{deptLabel(d)}</span>
                <span className="mt-1 block text-[13px] text-muted">{pick(DEPARTMENTS[d]?.hint)}</span>
              </ChoiceCard>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <p className="text-[15px] text-muted">
            {deptLabel(dept)} · {hospital?.name}
          </p>
          {doctors.loading && !doctors.data && <Loading />}
          <ErrorNote error={doctors.error} onRetry={doctors.reload} />
          {doctors.data?.doctors.length === 0 && <p className="card p-5 text-muted">{t('No doctors listed for this department yet.')}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {doctors.data?.doctors.map((d) => (
              <ChoiceCard
                key={d.id}
                selected={doctor?.id === d.id}
                onClick={() => {
                  setDoctor(d);
                  setSlot(null);
                  setDay(null);
                }}
                className="flex items-center gap-3"
              >
                {d.photo_url ? (
                  <img
                    src={d.photo_url}
                    alt=""
                    width={56}
                    height={56}
                    loading="lazy"
                    className="size-14 shrink-0 rounded-full object-cover ring-2 ring-brand-soft"
                  />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-bold text-brand">
                    {d.full_name
                      .replace('Dr. ', '')
                      .split(' ')
                      .map((p) => p[0])
                      .join('')
                      .slice(0, 2)}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block font-semibold">{d.full_name}</span>
                  <span className="block text-[13px] text-muted">
                    {t('{{n}} yrs', { n: d.experience_years })} · ★ {d.rating} · {d.languages.join(', ')}
                  </span>
                  <span className="block text-[13px] font-semibold text-leaf-dark">
                    {d.next_slot ? `${t('Next')}: ${formatDateTime(d.next_slot)}` : t('No free slots this week')} · {d.fee_inr ? `₹${d.fee_inr}` : t('Free')}
                  </span>
                </span>
              </ChoiceCard>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-5">
          {slots.loading && !slots.data && <Loading />}
          <ErrorNote error={slots.error} onRetry={slots.reload} />
          {slots.data && days.length === 0 && <p className="card p-5 text-muted">{t('No free slots this week. Try another doctor.')}</p>}
          {days.length > 0 && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((d) => {
                  const on = d.key === activeDay?.key;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setDay(d.key);
                        setSlot(null);
                      }}
                      className={`flex min-h-16 min-w-16 shrink-0 flex-col items-center justify-center rounded-2xl px-2 ${on ? 'bg-brand text-white' : 'border border-line bg-surface'}`}
                    >
                      <span className="text-xs font-semibold uppercase">{formatDateTime(d.first, { weekday: 'short' })}</span>
                      <span className="text-xl font-bold">{formatDateTime(d.first, { day: 'numeric' })}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {activeDay?.list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={s.is_booked}
                    aria-pressed={slot?.id === s.id}
                    onClick={() => setSlot(s)}
                    className={`min-h-12 rounded-xl text-[15px] font-semibold ${
                      s.is_booked
                        ? 'border border-dashed border-line bg-line-soft text-muted line-through'
                        : slot?.id === s.id
                          ? 'border-2 border-brand bg-brand-soft text-brand-dark'
                          : 'border border-line bg-surface'
                    }`}
                  >
                    {formatDateTime(s.starts_at, { hour: 'numeric', minute: '2-digit' })}
                  </button>
                ))}
              </div>
            </>
          )}
          <label className="flex flex-col gap-2">
            <span className="label">{t('What is the problem? (optional)')}</span>
            <textarea className="input min-h-20 py-3 text-base" maxLength={500} value={complaint} onChange={(e) => setComplaint(e.target.value)} />
          </label>
          <div className="card flex flex-col gap-1 p-4 text-[15px]">
            <span className="font-bold">{t('Summary')}</span>
            <span>{hospital?.name}</span>
            <span>
              {deptLabel(dept)} · {doctor?.full_name}
            </span>
            <span>{slot ? formatDateTime(slot.starts_at) : t('Pick a time')}</span>
            <span className="font-semibold text-leaf-dark">{fee ? t('Fee: ₹{{fee}} · payment at the next step', { fee }) : t('Fee: Free')}</span>
          </div>
        </div>
      )}

      <div className="sticky bottom-20 mt-6 md:bottom-4">
        {step < 4 ? (
          <button type="button" className="btn-primary min-h-14 w-full text-lg" disabled={!ready} onClick={() => setStep(step + 1)}>
            {t('Continue')}
          </button>
        ) : (
          <button type="button" className="btn-primary min-h-14 w-full text-lg" disabled={!slot || booking} onClick={confirm}>
            {booking ? t('Booking…') : fee ? t('Book and pay ₹{{fee}}', { fee }) : t('Confirm booking')}
          </button>
        )}
      </div>
    </div>
  );
}
