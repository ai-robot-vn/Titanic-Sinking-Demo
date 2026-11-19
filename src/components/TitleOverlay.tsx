import React from 'react';

interface TitleOverlayProps {
  bestScore: number;
  onStart: () => void;
  onStartNight: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  bestScore,
  onStart,
  onStartNight,
}) => {
  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none px-6 py-7 md:px-10 md:py-9 font-sans-ui">
      {/* Subtle vignette framing the sunlit Southampton harbor & ship */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 48%, rgba(5,11,20,0.04) 30%, rgba(4,9,17,0.68) 100%)',
        }}
      />

      {/* Top Maritime Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="apple-glass-panel px-4 py-2 rounded-2xl">
          <span className="text-[11px] tracking-[0.16em] uppercase text-amber-200 font-semibold">
            Southampton Berth 44 · Direct Helm Command
          </span>
        </div>

        {bestScore > 0 && (
          <div className="apple-glass-panel px-4 py-2 rounded-2xl text-right">
            <div className="text-[10px] tracking-[0.16em] uppercase text-slate-300/80">
              Record Voyage
            </div>
            <div className="text-base font-bold text-white tabular-nums">
              {bestScore.toLocaleString()} PTS
            </div>
          </div>
        )}
      </div>

      {/* Center Frosted Glass Title Card */}
      <div className="my-auto flex flex-col items-center text-center max-w-2xl mx-auto">
        <div className="apple-glass-panel px-8 py-8 md:px-12 md:py-10 rounded-3xl pointer-events-auto">
          <svg
            viewBox="0 0 520 132"
            className="w-full max-w-[430px] mx-auto mb-4"
            aria-label="RMS Titanic: Bridge Watch"
          >
            <line x1="28" y1="22" x2="188" y2="22" stroke="#e6c373" strokeWidth="1.2" opacity="0.65" />
            <line x1="332" y1="22" x2="492" y2="22" stroke="#e6c373" strokeWidth="1.2" opacity="0.65" />
            <g transform="translate(260, 22)">
              <circle r="15" fill="none" stroke="#e6c373" strokeWidth="1.5" />
              <polygon
                points="0,-11 3,-3 11,0 3,3 0,11 -3,3 -11,0 -3,-3"
                fill="#f6dfa4"
              />
            </g>
            <text
              x="260"
              y="68"
              textAnchor="middle"
              fill="#f8fafc"
              fontFamily="Cinzel, Georgia, serif"
              fontSize="38"
              fontWeight="700"
              letterSpacing="7"
            >
              RMS TITANIC
            </text>
            <text
              x="260"
              y="98"
              textAnchor="middle"
              fill="#f3d48c"
              fontFamily="-apple-system, BlinkMacSystemFont, 'Plus Jakarta Sans', sans-serif"
              fontSize="14"
              fontWeight="600"
              letterSpacing="8"
            >
              BRIDGE WATCH
            </text>
            <line x1="90" y1="114" x2="430" y2="114" stroke="#e6c373" strokeWidth="1" opacity="0.5" />
          </svg>

          <p className="text-sm md:text-base text-slate-200/90 max-w-lg mx-auto mb-7 leading-relaxed">
            Take immediate helm and engine telegraph command from Southampton Berth 44. Navigate clear of harbor vessels, Royal Navy escorts, and the lone North Atlantic iceberg while exploring accessible interior decks.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onStart}
              className="apple-glass-gold hover:brightness-110 active:scale-[0.99] inline-flex items-center justify-center px-8 py-3.5 text-amber-50 font-semibold tracking-[0.12em] uppercase text-sm rounded-2xl transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              Take The Helm At Dock
            </button>
            <button
              type="button"
              onClick={onStartNight}
              className="apple-glass-subtle hover:bg-white/15 inline-flex items-center justify-center px-5 py-3.5 text-slate-100 font-semibold tracking-[0.1em] uppercase text-xs rounded-2xl transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              April 14 Night Watch
            </button>
          </div>
        </div>
      </div>

      {/* Control Hint Bar */}
      <div className="flex justify-center">
        <div className="apple-glass-panel px-5 py-2 rounded-2xl text-xs tracking-[0.1em] uppercase text-slate-200/90 text-center">
          H Hide/Show Panels &nbsp;·&nbsp; A Autopilot &nbsp;·&nbsp; ← / → Steer Helm &nbsp;·&nbsp; W / X Telegraph &nbsp;·&nbsp; I / J / K / L Walk Decks &nbsp;·&nbsp; S Switch Deck
        </div>
      </div>
    </div>
  );
};
