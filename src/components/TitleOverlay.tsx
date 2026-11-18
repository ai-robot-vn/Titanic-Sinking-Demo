import React from 'react';

interface TitleOverlayProps {
  bestScore: number;
  onStart: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({ bestScore, onStart }) => {
  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none px-6 py-8 md:px-12 md:py-10">
      {/* Subtle dark vignette at top/bottom edges without blurring the live 3D wheelhouse */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 48%, rgba(5,11,20,0.08) 25%, rgba(4,9,17,0.78) 100%)',
        }}
      />

      {/* Top Maritime Header */}
      <div className="flex items-start justify-between">
        <div className="bg-[#070e18]/88 border border-[#c99c43]/45 px-4 py-2 rounded-sm">
          <span className="text-[11px] tracking-[0.26em] uppercase text-[#d8b467] font-semibold">
            NORTH ATLANTIC · 41°43′N 49°56′W · APRIL 14, 1912
          </span>
        </div>

        {bestScore > 0 && (
          <div className="bg-[#070e18]/88 border border-[#c99c43]/45 px-4 py-2 rounded-sm text-right">
            <div className="text-[10px] tracking-[0.2em] uppercase text-[#9fb2c7]">
              RECORD VOYAGE
            </div>
            <div className="text-base font-bold text-[#f3ead3] tabular-nums">
              {bestScore.toLocaleString()} PTS
            </div>
          </div>
        )}
      </div>

      {/* Center-Left / Upper Title Lockup leaving center ocean & wheelhouse calm */}
      <div className="my-auto flex flex-col items-center text-center max-w-2xl mx-auto">
        <div className="bg-[#060c16]/85 border border-[#c99c43]/55 px-8 py-7 md:px-12 md:py-9 rounded-sm shadow-2xl pointer-events-auto">
          {/* Bespoke Inline SVG Maritime Crest & Title Lockup */}
          <svg
            viewBox="0 0 520 132"
            className="w-full max-w-[440px] mx-auto mb-4"
            aria-label="RMS Titanic: Bridge Watch"
          >
            {/* Brass ornamental rules */}
            <line x1="28" y1="22" x2="188" y2="22" stroke="#c99c43" strokeWidth="1.2" opacity="0.7" />
            <line x1="332" y1="22" x2="492" y2="22" stroke="#c99c43" strokeWidth="1.2" opacity="0.7" />
            {/* White Star & Compass Emblem */}
            <g transform="translate(260, 22)">
              <circle r="15" fill="none" stroke="#c99c43" strokeWidth="1.5" />
              <polygon
                points="0,-11 3,-3 11,0 3,3 0,11 -3,3 -11,0 -3,-3"
                fill="#e6c373"
              />
            </g>
            <text
              x="260"
              y="68"
              textAnchor="middle"
              fill="#f4ebd2"
              fontFamily="Georgia, 'Times New Roman', serif"
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
              fill="#d8b467"
              fontFamily="Inter, sans-serif"
              fontSize="14"
              fontWeight="600"
              letterSpacing="8"
            >
              BRIDGE WATCH
            </text>
            <line x1="90" y1="114" x2="430" y2="114" stroke="#c99c43" strokeWidth="1" opacity="0.55" />
          </svg>

          <p className="text-sm md:text-base text-[#c5d4e6] max-w-md mx-auto mb-6 leading-relaxed">
            Command the helm from the mahogany wheelhouse. Read the moonlight, swing the rudder early, and guide 46,000 tons safely through Ice Alley.
          </p>

          <button
            type="button"
            onClick={onStart}
            className="inline-flex items-center justify-center gap-3 px-9 py-3.5 bg-[#c99c43] hover:bg-[#dcb15a] active:bg-[#b58934] text-[#08101c] font-bold tracking-[0.18em] uppercase text-sm rounded-sm transition-colors cursor-pointer shadow-lg"
          >
            TAKE THE HELM
          </button>
        </div>
      </div>

      {/* Flat Single Control-Hint Line */}
      <div className="flex justify-center">
        <div className="bg-[#070e18]/88 border border-[#c99c43]/35 px-5 py-2 rounded-sm text-xs tracking-[0.12em] uppercase text-[#c7d6e6] text-center">
          A / D Steer Helm &nbsp;·&nbsp; W / S Engine Telegraph &nbsp;·&nbsp; Space Searchlight &nbsp;·&nbsp; C Camera &nbsp;·&nbsp; Esc Pause
        </div>
      </div>
    </div>
  );
};
