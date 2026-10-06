// Family accounts on the phone: load the family list, switch the profile in
// use, and a banner so nobody books or raises an SOS for the wrong person.
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';
import { api } from '../lib/api';
import { relationLabel } from '../lib/labels';
import { familyLoaded, profileSwitched } from '../store';

const initial = (name) => (name ?? '').trim().charAt(0).toUpperCase();

// Refresh the family list when a personal account opens the app (kept offline in the store).
export function useFamily() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.session.user);
  const online = useSelector((s) => s.network.online);
  useEffect(() => {
    if (user?.role !== 'patient' || !online) return;
    api('/family', { profileId: null })
      .then((d) => dispatch(familyLoaded(d.members)))
      .catch(() => {});
  }, [user?.id, user?.role, online, dispatch]);
}

export function useSwitchProfile() {
  const dispatch = useDispatch();
  return (member) => dispatch(profileSwitched(member));
}

/** Row of people to switch between: "Me" and each family member. */
export function FamilySwitcher({ label }) {
  const { t } = useTranslation();
  const { user, profile, family } = useSelector((s) => s.session);
  const switchTo = useSwitchProfile();
  if (!family.length) return null;
  const people = [{ ...user, me: true }, ...family];
  const activeId = profile?.id ?? user.id;

  return (
    <div role="group" aria-label={label ?? t('Whose health?')}>
      {label && <p className="label mb-2">{label}</p>}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {people.map((p) => {
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => switchTo(p.me ? null : p)}
              className={`flex min-h-12 shrink-0 items-center gap-2 rounded-full border py-1.5 pr-4 pl-1.5 text-[15px] font-semibold ${
                active ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink'
              }`}
            >
              <span
                className={`grid size-9 place-items-center rounded-full text-base font-bold ${active ? 'bg-white text-brand' : 'bg-brand-soft text-brand'}`}
                aria-hidden="true"
              >
                {initial(p.full_name) || <Icon name="user" size={18} />}
              </span>
              <span className="flex flex-col items-start leading-tight">
                <span>{p.me ? t('Me') : p.full_name?.split(' ')[0]}</span>
                {!p.me && <span className={`text-xs font-medium ${active ? 'text-white/85' : 'text-muted'}`}>{relationLabel(p.relation)}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Shown on every page while acting for a family member. */
export function ActingBanner() {
  const { t } = useTranslation();
  const profile = useSelector((s) => s.session.profile);
  const switchTo = useSwitchProfile();
  if (!profile) return null;
  return (
    <div role="status" className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-3 text-[15px]">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-lg font-bold text-white" aria-hidden="true">
        {initial(profile.full_name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold tracking-wide text-accent uppercase">{t('Family profile')}</span>
        <span className="block truncate font-semibold">{t('Managing health for {{name}}', { name: profile.full_name })}</span>
      </span>
      <button type="button" className="shrink-0 rounded-xl bg-surface px-3 py-2 text-sm font-bold text-brand" onClick={() => switchTo(null)}>
        {t('Back to me')}
      </button>
    </div>
  );
}
