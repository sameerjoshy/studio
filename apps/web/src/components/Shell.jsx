import clsx from 'clsx';
import { LayoutGrid, LibraryBig, MessageSquare } from 'lucide-react';

const NAV = [
  { id: 'chat', label: 'Control Room', icon: MessageSquare },
  { id: 'capabilities', label: 'Capabilities', icon: LayoutGrid },
  { id: 'library', label: 'Library', icon: LibraryBig },
];

export default function Shell({ tab, setTab, children }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 items-center justify-between gap-4 border-b border-line/70 px-4 py-3 md:h-screen md:w-60 md:flex-col md:items-stretch md:justify-start md:border-b-0 md:border-r md:px-4 md:py-6">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 100 60" className="h-7 w-11" aria-hidden="true">
            <path d="M6 5 L46 30 L6 55 Z" fill="#34D399" />
            <path d="M94 5 L54 30 L94 55 Z" fill="#ffffff" />
          </svg>
          <div className="leading-tight">
            <div className="text-sm font-extrabold tracking-wide text-white">GTM-360</div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.28em] text-mint">
              Studio
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-1 md:mt-8 md:flex-col md:items-stretch md:gap-1.5">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={clsx(
                'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition',
                tab === id
                  ? 'bg-accent/15 text-white ring-1 ring-accent/40'
                  : 'text-fog hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>

        <div className="hidden md:mt-auto md:block">
          <div className="flex items-center gap-2 px-3 text-[10px] text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            Open access · free compute · v0.1
          </div>
        </div>
      </aside>

      <main className="min-h-0 flex-1 md:h-screen md:overflow-hidden">{children}</main>
    </div>
  );
}
