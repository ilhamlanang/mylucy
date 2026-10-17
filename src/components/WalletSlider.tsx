import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CreditCard, Wallet as WalletIcon } from 'lucide-react';
import { Wallet } from '../types/finance';
import { formatIDR } from '../lib/supabase';

interface WalletSliderProps {
  wallets: Wallet[];
  walletBalances: Record<string, number>;
  totalBalance: number;
  onManageWallets: () => void;
}

export const WalletSlider: React.FC<WalletSliderProps> = ({
  wallets,
  walletBalances,
  totalBalance,
  onManageWallets
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  // Sync active snapped card state via scrollsnapchange + IntersectionObserver fallback
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const items = Array.from(scroller.querySelectorAll<HTMLElement>('.wallet-carousel-item'));
    if (items.length === 0) return;

    // 1. Fallback for carousel-snap-highlights if container-type: scroll-state is unsupported
    let snapHighlightObserver: IntersectionObserver | null = null;
    if (typeof CSS !== 'undefined' && !CSS.supports('container-type', 'scroll-state')) {
      snapHighlightObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            entry.target.classList.toggle('is-snapped', entry.isIntersecting);
          });
        },
        {
          root: scroller,
          rootMargin: '0px -49%'
        }
      );
      items.forEach((item) => snapHighlightObserver?.observe(item));
    }

    // 2. Scroll Snap State Sync: native scrollsnapchange or IntersectionObserver fallback
    const handleSnapChange = (event: Event) => {
      const snapEvent = event as Event & { snapTargetInline?: Element | null };
      const snappedEl = snapEvent.snapTargetInline;
      if (snappedEl) {
        const idx = items.indexOf(snappedEl as HTMLElement);
        if (idx !== -1) setActiveIndex(idx);
      }
    };

    let stateObserver: IntersectionObserver | null = null;
    if ('onscrollsnapchange' in HTMLElement.prototype) {
      scroller.addEventListener('scrollsnapchange', handleSnapChange);
    } else {
      stateObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const idx = items.indexOf(entry.target as HTMLElement);
              if (idx !== -1) setActiveIndex(idx);
            }
          }
        },
        { root: scroller, threshold: 0.65 }
      );
      items.forEach((item) => stateObserver?.observe(item));
    }

    return () => {
      scroller.removeEventListener('scrollsnapchange', handleSnapChange);
      snapHighlightObserver?.disconnect();
      stateObserver?.disconnect();
    };
  }, [wallets]);

  const scrollToSlide = (index: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const items = scroller.querySelectorAll<HTMLElement>('.wallet-carousel-item');
    const target = items[index];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      setActiveIndex(index);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-5 sm:p-6 border border-slate-200/80 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-indigo-600" />
            Rincian Saldo per Kantong
          </h3>
          <p className="text-xs text-slate-500">
            Geser kartu untuk melihat rincian saldo masing-masing sumber dana
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollToSlide(Math.max(0, activeIndex - 1))}
              disabled={activeIndex === 0}
              className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              aria-label="Kartu sebelumnya"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollToSlide(Math.min(wallets.length - 1, activeIndex + 1))}
              disabled={activeIndex >= wallets.length - 1}
              className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              aria-label="Kartu berikutnya"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={onManageWallets}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 ml-2 cursor-pointer"
          >
            Kelola Dompet &rarr;
          </button>
        </div>
      </div>

      {/* Horizontal Scroll-Snap Slider */}
      <div
        ref={scrollerRef}
        className="wallet-carousel gap-4 py-3 px-1"
      >
        {wallets.map((w, idx) => {
          const balance = walletBalances[w.id] || 0;
          const sharePct = totalBalance > 0 ? Math.max(Math.round((balance / totalBalance) * 100), 0) : 0;

          return (
            <div
              key={w.id}
              id={`wallet-slide-${idx}`}
              className="wallet-carousel-item shrink-0 w-[82%] sm:w-[310px]"
            >
              <div
                className="wallet-card h-full rounded-2xl p-5 text-white relative overflow-hidden border border-white/15 shadow-md"
                style={{
                  background: `linear-gradient(135deg, ${w.color} 0%, #1e1b4b 100%)`
                }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="inline-block rounded-full bg-white/20 backdrop-blur-xs px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                      {w.type === 'bank' ? 'Rekening Bank' : w.type === 'ewallet' ? 'E-Wallet' : 'Uang Tunai'}
                    </span>
                    <h4 className="mt-2 text-lg font-bold tracking-tight text-white">
                      {w.name}
                    </h4>
                  </div>
                  <div className="h-9 w-9 rounded-xl bg-white/15 flex items-center justify-center">
                    <WalletIcon className="h-4 w-4 text-white" />
                  </div>
                </div>

                <div className="mt-6">
                  <p className="text-[11px] uppercase tracking-wider text-white/75">
                    Saldo Tersedia
                  </p>
                  <p className="text-2xl font-extrabold tracking-tight mt-0.5">
                    {formatIDR(balance)}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between text-xs text-white/85">
                  <span>Proporsi Total Saldo</span>
                  <span className="font-bold">{sharePct}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation Landmark for Snap State Sync */}
      <nav aria-label="Indikator kantong dana" className="mt-2 flex items-center justify-center gap-2">
        {wallets.map((w, idx) => (
          <button
            key={w.id}
            type="button"
            onClick={() => scrollToSlide(idx)}
            aria-current={activeIndex === idx ? 'true' : undefined}
            aria-label={`Tampilkan kantong ${w.name}`}
            className={`h-2 rounded-full transition-all cursor-pointer ${
              activeIndex === idx ? 'w-6 bg-indigo-600' : 'w-2 bg-slate-200 hover:bg-slate-300'
            }`}
          />
        ))}
      </nav>
    </section>
  );
};

