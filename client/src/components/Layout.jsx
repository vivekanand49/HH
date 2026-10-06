// One layout, three shapes:
//  phone (<768px): top bar with SOS + bottom tab bar
//  tablet (768–1023px): icon rail on the left
//  laptop/PC (≥1024px): full sidebar with labels
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';
import { LanguagePicker, Logo, OfflineBanner } from './ui';
import { ActingBanner, useFamily } from './Family';
import { ADMIN_ROLES, STAFF_ROLES } from '../store';

export default function Layout() {
  const { t } = useTranslation();
  const role = useSelector((s) => s.session.user?.role);
  const isStaff = STAFF_ROLES.includes(role);
  useFamily();

  const items = [
    { to: '/', icon: 'home', label: t('Home'), end: true },
    { to: '/book', icon: 'calendar', label: t('Book') },
    { to: '/records', icon: 'file', label: t('Records') },
    { to: '/assistant', icon: 'chat', label: t('Assistant') },
    ...(role === 'doctor' ? [{ to: '/doctor', icon: 'user', label: t('My patients') }] : []),
    ...(role === 'health_worker' ? [{ to: '/worker', icon: 'user', label: t('My villagers') }] : []),
    ...(isStaff ? [{ to: '/console', icon: 'desk', label: t('Emergency desk') }] : []),
    ...(ADMIN_ROLES.includes(role) ? [{ to: '/admin', icon: 'hospital', label: t('Hospital admin') }] : []),
    { to: '/profile', icon: 'user', label: t('Profile') },
  ];

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-lg focus:bg-surface focus:p-3">
        {t('Skip to content')}
      </a>

      {/* Phone top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur md:hidden">
        <Logo size={40} />
        <span className="flex items-center gap-2">
          <LanguagePicker compact />
          <Link to="/emergency" className="btn-sos min-h-11 rounded-full px-4 text-[15px]">
            <Icon name="phone" size={18} /> {t('SOS')}
          </Link>
        </span>
      </header>

      {/* Tablet rail / desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-24 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex lg:w-64 lg:px-4">
        <div className="mb-6 flex justify-center lg:justify-start lg:px-2">
          <span className="lg:hidden">
            <Logo size={52} withName={false} />
          </span>
          <span className="hidden lg:inline">
            <Logo size={46} tagline />
          </span>
        </div>
        <nav aria-label={t('Main')} className="flex flex-col gap-1">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-xs font-semibold lg:flex-row lg:gap-3 lg:px-3 lg:text-[15px] ${
                  isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-bg'
                }`
              }
            >
              <Icon name={it.icon} />
              <span className="text-center lg:text-left">{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        <span className="mb-3 hidden justify-center lg:flex">
          <LanguagePicker />
        </span>
        <span className="mb-3 flex justify-center lg:hidden">
          <LanguagePicker compact />
        </span>
        <Link to="/emergency" className="btn-sos flex-col gap-1 rounded-2xl py-3 text-sm lg:flex-row lg:text-base">
          <Icon name="phone" size={22} /> {t('Emergency')}
        </Link>
      </aside>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-10">
        <OfflineBanner />
        <ActingBanner />
        <Outlet />
      </main>

      {/* Phone bottom tabs */}
      <nav
        aria-label={t('Main')}
        className="fixed inset-x-0 bottom-0 z-20 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              `flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${isActive ? 'text-brand' : 'text-muted'}`
            }
          >
            <Icon name={it.icon} />
            <span className="max-w-full truncate px-0.5">{it.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
