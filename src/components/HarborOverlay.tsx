import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { HARBOR_CHAPTERS, TelemetrySnapshot } from '../game/types';

interface HarborOverlayProps {
  telemetry: TelemetrySnapshot;
  onSelectChapter: (idx: number) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onToggleAutoPlay: () => void;
  onSkipToNight: () => void;
  onToggleMute: () => void;
}

export const HarborOverlay: React.FC<HarborOverlayProps> = ({
  telemetry,
  onSelectChapter,
  onPrevChapter,
  onNextChapter,
  onToggleAutoPlay,
  onSkipToNight,
  onToggleMute,
}) => {
  if (telemetry.phase === 'timeskip') {
    const pct = Math.round(telemetry.timeSkipProgress * 100);
    return (
      <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-5 md:p-8">
        <div className="flex justify-center">
          <div className="bg-[#060d18]/90 border border-[#c99c43]/55 px-6 py-2.5 rounded-sm text-center">
            <div className="text-[11px] tracking-[0.22em] uppercase text-[#d8b467] font-semibold">
              NORTH ATLANTIC CROSSING · FAST-FORWARD
            </div>
            <div className="font-maritime-serif text-lg md:text-xl font-bold text-[#f4ebd2] tracking-wide mt-0.5 tabular-nums">
              {telemetry.timeSkipDateLabel}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="w-full max-w-md bg-[#060d18]/90 border border-[#c99c43]/50 px-5 py-3 rounded-sm">
            <div className="flex items-center justify-between text-[11px] text-[#c7d6e6] tracking-wider uppercase mb-1.5 tabular-nums">
              <span>Southampton, Apr 10</span>
              <span className="text-[#e6c373] font-semibold">{pct}%</span>
              <span>Ice Alley, Apr 14</span>
            </div>
            <div className="h-1.5 w-full bg-[#0d1c30] rounded-[1px] overflow-hidden">
              <div
                className="h-full bg-[#d8b467] transition-all duration-100"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (telemetry.phase !== 'harbor') return null;

  const chapter =
    HARBOR_CHAPTERS[telemetry.harborChapterIndex] ?? HARBOR_CHAPTERS[0];
  const progressPct = Math.round(telemetry.harborProgress * 100);

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 md:p-5">
      {/* Top Bar: Minimal Context + Audio Control */}
      <div className="flex items-start justify-between gap-4">
        <div className="bg-[#070e18]/88 border border-[#c99c43]/45 px-4 py-2.5 rounded-sm">
          <div className="flex items-center gap-2 text-[11px] text-[#d8b467] tracking-[0.14em] uppercase">
            <span>{chapter.kicker}</span>
          </div>
          <div className="text-xs text-[#c7d6e6] mt-0.5 tabular-nums">
            Speed {telemetry.speedKnots} kts
            <span className="mx-2 text-[#c99c43]/50" aria-hidden="true">
              ·
            </span>
            Channel Departure {progressPct}%
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            title="Mute / Unmute (M)"
            className="bg-[#070e18]/88 hover:bg-[#112036] border border-[#c99c43]/45 p-2.5 rounded-sm text-[#e6c373] cursor-pointer transition-colors"
          >
            {telemetry.isMuted ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Bottom Center Harbor Briefing Dock (Center 3D Viewport Stays 100% Clear) */}
      <div className="flex flex-col items-center">
        <div className="pointer-events-auto bg-[#070e18]/92 border border-[#c99c43]/55 rounded-sm px-5 py-4 max-w-3xl w-full shadow-2xl">
          {/* Segmented Chapter Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 pb-3 border-b border-[#c99c43]/20">
            {HARBOR_CHAPTERS.map((ch, idx) => {
              const active = idx === telemetry.harborChapterIndex;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => onSelectChapter(idx)}
                  className={`px-2.5 py-1 text-[11px] font-semibold tracking-wider uppercase rounded-[2px] border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#c99c43] text-[#08101c] border-[#e6c373]'
                      : 'bg-[#0b1626] text-[#c3d3e5] border-[#c99c43]/25 hover:border-[#c99c43]/60'
                  }`}
                >
                  {ch.shortTitle}
                </button>
              );
            })}
          </div>

          {/* Active Chapter Narrative */}
          <div className="py-3">
            <h2 className="font-maritime-serif text-xl md:text-2xl font-bold text-[#f4ebd2] tracking-wide">
              {chapter.title}
            </h2>
            <p className="text-sm text-[#c7d6e6] leading-relaxed mt-1.5">
              {chapter.description}
            </p>
            <div className="text-xs text-[#d8b467] mt-2 tracking-wide">
              {chapter.controlsHint}
            </div>
          </div>

          {/* Channel Progress Track */}
          <div className="h-1 w-full bg-[#0d1c30] rounded-[1px] overflow-hidden mb-3">
            <div
              className="h-full bg-[#c99c43] transition-all duration-150"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Navigation & Fast-Forward Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onPrevChapter}
                disabled={telemetry.harborChapterIndex === 0}
                className="flex items-center gap-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider rounded-sm border bg-[#0b1626] hover:bg-[#14253d] disabled:opacity-40 disabled:cursor-not-allowed text-[#d9e5f2] border-[#c99c43]/35 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>

              <button
                type="button"
                onClick={onToggleAutoPlay}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider rounded-sm border bg-[#0b1626] hover:bg-[#14253d] text-[#e6c373] border-[#c99c43]/35 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                {telemetry.harborAutoPlay ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    Pause Tour
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Resume Tour
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onNextChapter}
                className="flex items-center gap-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider rounded-sm border bg-[#0b1626] hover:bg-[#14253d] text-[#d9e5f2] border-[#c99c43]/35 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                {telemetry.harborChapterIndex === HARBOR_CHAPTERS.length - 1
                  ? 'Clear Harbor'
                  : 'Next'}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={onSkipToNight}
              className="flex items-center gap-2 px-4 py-2 bg-[#c99c43] hover:bg-[#dcb15a] text-[#08101c] font-bold tracking-[0.14em] uppercase text-xs rounded-sm cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              <FastForward className="w-3.5 h-3.5" />
              Fast-Forward to April 14 [Space]
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
