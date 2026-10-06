import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../components/Icon';
import { ErrorNote, Loading, PageTitle, StaleNote } from '../components/ui';
import { apiUpload, fileUrl, useCachedApi } from '../lib/api';
import { compressImage } from '../lib/image';
import { formatDateTime } from '../i18n';
import { flagVitals } from '@swasthya/shared/vitals';

const KINDS = {
  lab: { abbr: 'LAB', tone: 'bg-brand-soft text-brand' },
  prescription: { abbr: 'Rx', tone: 'bg-warn-soft text-warn' },
  imaging: { abbr: 'IMG', tone: 'bg-accent-soft text-accent' },
  discharge: { abbr: 'DOC', tone: 'bg-leaf-soft text-leaf-dark' },
  vaccination: { abbr: 'VAC', tone: 'bg-leaf-soft text-leaf-dark' },
  other: { abbr: 'DOC', tone: 'bg-line-soft text-ink' },
};

const FILTERS = [
  ['all', 'All'],
  ['lab', 'Lab tests'],
  ['prescription', 'Prescriptions'],
  ['imaging', 'Scans'],
  ['other', 'Other'],
];

function UploadReport({ onUploaded }) {
  const { t } = useTranslation();
  const camera = useRef(null);
  const picker = useRef(null);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('lab');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const blob = await compressImage(file);
      await apiUpload(`/me/records/upload?title=${encodeURIComponent(title)}&kind=${kind}`, blob);
      setFile(null);
      setTitle('');
      onUploaded();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const choose = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 80));
    }
    e.target.value = '';
  };

  return (
    <section className="card mb-5 p-4">
      <h2 className="mb-1 text-lg font-bold">{t('Add a paper report')}</h2>
      <p className="mb-3 text-sm text-muted">
        {t('Take a clear photo of a lab report or prescription. It is made smaller before sending, so it works on slow internet.')}
      </p>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={choose} />
      <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={choose} />
      {!file ? (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn-primary" onClick={() => camera.current.click()}>
            {t('Take photo')}
          </button>
          <button type="button" className="btn-outline" onClick={() => picker.current.click()}>
            {t('Choose file')}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="truncate text-sm text-muted">{file.name}</p>
          <label className="flex flex-col gap-1.5">
            <span className="label">{t('What is this report?')}</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">{t('Type')}</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="lab">{t('Lab tests')}</option>
              <option value="prescription">{t('Prescriptions')}</option>
              <option value="imaging">{t('Scans')}</option>
              <option value="discharge">{t('Discharge summary')}</option>
              <option value="other">{t('Other')}</option>
            </select>
          </label>
          <ErrorNote error={error} />
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn-outline" onClick={() => setFile(null)} disabled={busy}>
              {t('Cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
              {busy ? t('Uploading…') : t('Upload')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

async function openFile(fileId, onError) {
  const win = window.open('', '_blank'); // open now, so pop-up blockers allow it
  try {
    const url = await fileUrl(fileId);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (err) {
    win?.close();
    onError(err);
  }
}

export default function Records() {
  const { t } = useTranslation();
  const [openError, setOpenError] = useState(null);
  const [filter, setFilter] = useState('all');
  const { data, loading, error, stale, savedAt, reload } = useCachedApi('/me/records');
  const summary = useCachedApi('/me/summary');
  const vitals = useCachedApi('/me/vitals');
  const allergies = (summary.data?.conditions ?? []).filter((c) => c.kind === 'allergy');

  const records = (data?.records ?? []).filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'other') return !['lab', 'prescription', 'imaging'].includes(r.kind);
    return r.kind === filter;
  });
  const hospitals = new Set((data?.records ?? []).map((r) => r.hospital_name)).size;

  return (
    <div className="mx-auto max-w-4xl">
      <PageTitle
        title={t('My health records')}
        image="/img/family.jpg"
        imagePosition="50% 30%"
        subtitle={data ? t('{{n}} records from {{h}} hospitals', { n: data.records.length, h: hospitals }) : undefined}
      />

      {allergies.length > 0 && (
        <div className="mb-4 flex items-center gap-2.5 rounded-2xl bg-sos-soft p-3.5 text-sos-dark">
          <Icon name="alert" />
          <span className="text-[15px]">
            <strong>
              {t('Allergy')}: {allergies.map((a) => a.name).join(', ')}.
            </strong>{' '}
            {t('Every doctor sees this first.')}
          </span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('Filter records')}>
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`chip ${filter === key ? 'border-ink bg-ink text-white' : ''}`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {vitals.data?.vitals.length > 0 && (
        <section className="card mb-5 overflow-x-auto p-4">
          <h2 className="mb-2 text-lg font-bold">{t('Health readings')}</h2>
          <table className="w-full min-w-[420px] text-left text-[15px]">
            <thead className="text-sm text-muted">
              <tr>
                <th className="py-1.5 font-semibold">{t('Date')}</th>
                <th className="font-semibold">BP</th>
                <th className="font-semibold">{t('Sugar')}</th>
                <th className="font-semibold">{t('Weight')}</th>
                <th className="font-semibold">{t('By')}</th>
              </tr>
            </thead>
            <tbody>
              {vitals.data.vitals.map((v) => {
                const f = flagVitals(v);
                return (
                  <tr key={v.id} className="border-t border-line-soft">
                    <td className="py-2">{formatDateTime(v.recorded_at, { day: 'numeric', month: 'short' })}</td>
                    <td className={f.some((x) => x.startsWith('bp')) ? 'font-bold text-sos-dark' : ''}>{v.systolic ? `${v.systolic}/${v.diastolic}` : '—'}</td>
                    <td className={f.some((x) => x.startsWith('sugar')) ? 'font-bold text-sos-dark' : ''}>{v.sugar_mgdl ?? '—'}</td>
                    <td>{v.weight_kg ?? '—'}</td>
                    <td className="text-sm text-muted">{v.recorded_by_name ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <UploadReport onUploaded={reload} />

      <StaleNote stale={stale} savedAt={savedAt} />
      <ErrorNote error={error} onRetry={reload} />
      <ErrorNote error={openError} />
      {loading && !data && <Loading />}

      <ul className="grid gap-3 md:grid-cols-2">
        {records.map((r) => {
          const k = KINDS[r.kind] ?? KINDS.other;
          return (
            <li key={r.id} className="card flex items-center gap-3 p-4">
              <span className={`grid size-12 shrink-0 place-items-center rounded-xl text-xs font-extrabold ${k.tone}`}>{k.abbr}</span>
              <span className="min-w-0 flex-1">
                <span className="block leading-snug font-semibold">{r.title}</span>
                <span className="block text-[13px] text-muted">
                  {r.hospital_name ?? t('Uploaded by you')} · {formatDateTime(r.recorded_on, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                {r.summary && <span className="block text-[13px] font-semibold whitespace-pre-line">{r.summary}</span>}
              </span>
              {r.file_id && (
                <button
                  type="button"
                  onClick={() => openFile(r.file_id, setOpenError)}
                  className="grid size-11 shrink-0 place-items-center rounded-xl border border-line"
                  aria-label={`${t('Open')} ${r.title}`}
                >
                  <Icon name="download" size={20} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {data && records.length === 0 && <p className="p-6 text-center text-muted">{t('No records of this type yet.')}</p>}

      <p className="mt-6 flex items-start gap-2.5 text-sm text-muted">
        <Icon name="shield" size={18} className="text-brand" />
        {t('Saved on this phone, so records open without internet. Only doctors you allow can see them, and every view is logged.')}
      </p>
    </div>
  );
}
