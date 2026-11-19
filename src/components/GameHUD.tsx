import React, { useEffect, useState } from 'react';
import {
  Anchor,
  Camera,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Droplets,
  Eye,
  EyeOff,
  FastForward,
  LifeBuoy,
  Navigation,
  Pause,
  Search,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  AftermathFocusTarget,
  TELEGRAPH_NOTCHES,
  TelemetrySnapshot,
  VESSEL_SPOTS,
  VesselSpotId,
} from '../game/types';

interface GameHUDProps {
  telemetry: TelemetrySnapshot;
  onSelectTelegraph?: (idx: number) => void;
  onSetRudder: (deg: number | null) => void;
  onToggleAutopilot: () => void;
  onTriggerSearchlight: () => void;
  onToggleCamera: () => void;
  onFocusSpot: (spotId: VesselSpotId) => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onSkipSinking: () => void;
  onFastForwardRescue: () => void;
  onFocusAftermath: (target: AftermathFocusTarget) => void;
  onOpenReport: () => void;
  onRestart: () => void;
}

function getCardinalLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function formatCountdown(totalSec: number): string {
  const clamped = Math.max(0, Math.ceil(totalSec));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  telemetry,
  onSelectTelegraph,
  onSetRudder,
  onToggleAutopilot,
  onTriggerSearchlight,
  onToggleCamera,
  onFocusSpot,
  onTogglePause,
  onToggleMute,
  onSkipSinking,
  onFastForwardRescue,
  onFocusAftermath,
  onOpenReport,
  onRestart,
}) => {
  const [panelsVisible, setPanelsVisible] = useState(true);
  const [dockCollapsed, setDockCollapsed] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyH' && !e.repeat) {
        setPanelsVisible((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const isSinking = telemetry.phase === 'sinking';
  const isAftermath = telemetry.phase === 'aftermath';
  const sinkingStageText =
    telemetry.sinkProgress < 0.4
      ? 'BOW FLOODING — STERN RISING ABOVE SEA'
      : telemetry.sinkProgress < 0.56
        ? 'HULL FRACTURED AT MIDSHIPS — BREAKING IN TWO'
        : telemetry.sinkProgress < 0.78
          ? 'BOW SUBMERGED — STERN REARING VERTICAL'
          : 'FINAL PLUNGE — SLOW DEEP-SEA DESCENT';

  const hullPct = telemetry.hullIntegrity;
  const hullColor =
    hullPct > 60 ? '#34d399' : hullPct > 30 ? '#fbbf24' : '#ef4444';

  const floodPct = telemetry.floodingPct;
  const floodColor = floodPct > 75 ? '#ef4444' : '#38bdf8';

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3.5 md:p-5 font-sans-ui">
      {/* TOP PERIMETER BAR */}
      <div className="flex items-start justify-between gap-3">
        {/* Top-Left: Hull Watertight Compartments, Flooding & Distance */}
        <div
          className={`transition-all duration-300 ease-out ${
            panelsVisible
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 -translate-y-2 pointer-events-none'
          }`}
        >
          <div className="apple-glass-panel px-4 py-3 rounded-2xl min-w-[228px]">
            <div className="flex items-center justify-between text-[10px] font-semibold tracking-[0.14em] uppercase text-slate-300/90 mb-2">
              <span>Watertight Hull</span>
              <span className="font-bold tabular-nums text-xs" style={{ color: hullColor }}>
                {hullPct}%
              </span>
            </div>

            <div className="grid grid-cols-5 gap-1.5 mb-2.5">
              {[0, 1, 2, 3, 4].map((idx) => {
                const compThreshold = (5 - idx) * 20;
                const intact = hullPct >= compThreshold - 10;
                return (
                  <div
                    key={idx}
                    className="h-2 rounded-md transition-colors duration-200"
                    style={{
                      backgroundColor: intact ? hullColor : 'rgba(239, 68, 68, 0.34)',
                      border: '1px solid rgba(255,255,255,0.16)',
                    }}
                  />
                );
              })}
            </div>

            {(floodPct > 0 || isSinking || isAftermath) && (
              <div className="mb-2.5">
                <div className="flex items-center justify-between text-[10px] font-semibold tracking-[0.12em] uppercase mb-1">
                  <span className="flex items-center gap-1 text-sky-300">
                    <Droplets className="w-3 h-3" />
                    Flooding
                  </span>
                  <span className="font-bold tabular-nums" style={{ color: floodColor }}>
                    {floodPct}%
                    {!isSinking && telemetry.waterIngressRate > 0 && ` (+${telemetry.waterIngressRate}%/s)`}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-white/10 rounded-md overflow-hidden border border-white/10">
                  <div
                    className="h-full transition-all duration-150 rounded-md"
                    style={{ width: `${floodPct}%`, backgroundColor: floodColor }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-100 tabular-nums pt-0.5 border-t border-white/10">
              <span className="text-slate-300/80 uppercase tracking-[0.08em] text-[10px] truncate max-w-[145px]">
                {telemetry.endlessMode ? 'Endless Watch' : telemetry.zoneLabel}
              </span>
              <span className="font-semibold text-amber-200 shrink-0">
                {telemetry.distanceNm.toFixed(1)}
                {!telemetry.endlessMode && ` / ${telemetry.targetDistanceNm.toFixed(1)} NM`}
                {telemetry.endlessMode && ' NM'}
              </span>
            </div>
          </div>
        </div>

        {/* Top-Center: Compass Readout & Dynamic Event / Distress Banners */}
        <div
          className={`flex flex-col items-center gap-2 transition-all duration-300 ease-out ${
            panelsVisible
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 -translate-y-2 pointer-events-none'
          }`}
        >
          <div className="apple-glass-panel px-4 py-2 rounded-2xl flex items-center gap-3">
            <Compass className="w-4 h-4 text-amber-200" />
            <div className="text-sm font-semibold tracking-[0.12em] text-white tabular-nums">
              {String(telemetry.headingDeg).padStart(3, '0')}° {getCardinalLabel(telemetry.headingDeg)}
            </div>
            <div className="h-3.5 w-[1px] bg-white/20" />
            <div className="text-xs font-semibold tracking-[0.08em] text-amber-200 tabular-nums">
              {telemetry.speedKnots} KTS
            </div>
          </div>

          {isSinking ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="apple-glass-danger px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.14em] uppercase text-red-100">
                ▲ {sinkingStageText}
              </div>
              <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-amber-100 tabular-nums">
                Lifeboats Lowered: {telemetry.lifeboatsLaunched} / 16
              </div>
            </div>
          ) : isAftermath ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {telemetry.carpathiaSunk && (
                <div className="apple-glass-danger px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-red-100">
                  ▲ RMS Carpathia Struck — Breaking Apart &amp; Sinking
                </div>
              )}

              {!telemetry.carpathiaSunk && telemetry.carpathiaStage === 'waiting' && (
                <>
                  {telemetry.warshipsIntact > 0 && telemetry.warshipRescuing ? (
                    <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-emerald-200 flex items-center gap-1.5 tabular-nums">
                      <LifeBuoy className="w-3.5 h-3.5 text-emerald-300" />
                      Escort Warship Rescuing · {telemetry.warshipSurvivors} / 356 Aboard ({telemetry.warshipBoatsRecovered} / 8 Boats)
                    </div>
                  ) : telemetry.warshipsIntact > 0 ? (
                    <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-sky-200 flex items-center gap-1.5 tabular-nums">
                      <Anchor className="w-3.5 h-3.5 text-sky-300" />
                      Escort Warship Closing In · Lifeboats: {telemetry.lifeboatsLaunched} / 16
                    </div>
                  ) : null}
                  <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-amber-200 flex items-center gap-1.5 tabular-nums">
                    <Clock className="w-3.5 h-3.5 text-amber-200" />
                    RMS Carpathia Arrives In {formatCountdown(telemetry.carpathiaEtaSec)}
                  </div>
                </>
              )}

              {!telemetry.carpathiaSunk && telemetry.carpathiaStage === 'approaching' && (
                <>
                  <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-sky-200 flex items-center gap-1.5 tabular-nums">
                    <Anchor className="w-3.5 h-3.5 text-sky-300" />
                    RMS Carpathia Approaching Slowly · {telemetry.carpathiaDistanceM} M
                  </div>
                  <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-amber-100 tabular-nums">
                    Aboard: {telemetry.survivorsRescued} / 712 · Boats: {telemetry.boatsRecovered} / 16
                  </div>
                </>
              )}

              {!telemetry.carpathiaSunk && telemetry.carpathiaStage === 'boarding' && (
                <>
                  <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-emerald-200 flex items-center gap-1.5">
                    <LifeBuoy className="w-3.5 h-3.5 text-emerald-300" />
                    Joint Rescue In Progress — Warship &amp; Carpathia Boarding
                  </div>
                  <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-amber-100 tabular-nums">
                    Survivors Aboard: {telemetry.survivorsRescued} / 712 · Boats: {telemetry.boatsRecovered} / 16
                  </div>
                </>
              )}

              {!telemetry.carpathiaSunk && telemetry.carpathiaStage === 'complete' && (
                <>
                  <div className="apple-glass-panel px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-emerald-200 flex items-center gap-1.5">
                    <LifeBuoy className="w-3.5 h-3.5 text-emerald-300" />
                    Rescue Complete — 712 Survivors Aboard Warship &amp; RMS Carpathia
                  </div>
                  <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-amber-200 tabular-nums">
                    All {telemetry.boatsRecovered} Lifeboats Recovered
                  </div>
                </>
              )}

              {telemetry.activeSubmarines > 0 && (
                <div className="apple-glass-danger px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-red-100 tabular-nums">
                  ▲ {telemetry.activeSubmarines} U-Boat(s) Firing — Warships Returning Fire
                </div>
              )}

              {telemetry.activeSubmarines === 0 && telemetry.submarinesSunk > 0 && (
                <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-amber-200 tabular-nums">
                  {telemetry.submarinesSunk} Submarine(s) Sunk By Warships
                </div>
              )}
            </div>
          ) : (
            <>
              {telemetry.icebergWarning && (
                <div className="apple-glass-danger px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.16em] uppercase text-red-100">
                  ▲ {telemetry.icebergWarning}
                </div>
              )}

              {telemetry.activeSubmarines > 0 && !telemetry.icebergWarning && !telemetry.lastEventText && (
                <div className="apple-glass-danger px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.14em] uppercase text-red-100 tabular-nums">
                  ▲ {telemetry.activeSubmarines} U-Boat(s) Firing — Escort Warships Returning Fire
                </div>
              )}

              {telemetry.bowPanicActive && !telemetry.lastEventText && (
                <div className="apple-glass-danger px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.14em] uppercase text-red-100">
                  ▲ Passengers Panicking — Rushing To The Bow
                </div>
              )}

              {telemetry.autopilotEnabled && !telemetry.lastEventText && !telemetry.icebergWarning && telemetry.activeSubmarines === 0 && (
                <div className="apple-glass-panel px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.14em] uppercase text-emerald-200">
                  Autopilot Active — Wheelhouse Crew At The Helm [A]
                </div>
              )}

              {telemetry.lastEventText && !telemetry.icebergWarning && (
                <div className="apple-glass-panel px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-amber-100">
                  {telemetry.lastEventText}
                </div>
              )}

              {!telemetry.icebergWarning && !telemetry.lastEventText && !telemetry.autopilotEnabled && !telemetry.bowPanicActive && telemetry.activeSubmarines === 0 && telemetry.focusSpotCategory === 'interior' && (
                <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[10px] font-semibold tracking-[0.12em] uppercase text-amber-200">
                  {telemetry.focusSpotLabel} · I / J / K / L Walk Deck · Drag Look
                </div>
              )}
            </>
          )}
        </div>

        {/* Top-Right: Score & Always-Accessible Hide/Show Panels Toggle */}
        <div className="flex items-start gap-2">
          <div
            className={`apple-glass-panel px-4 py-2 rounded-2xl text-right transition-all duration-300 ease-out ${
              panelsVisible
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 -translate-y-2 pointer-events-none'
            }`}
          >
            <div className="flex items-center justify-end gap-2 text-[10px] font-semibold tracking-[0.14em] uppercase text-slate-300/90">
              <span>Score</span>
              {telemetry.combo > 1 && (
                <span className="text-amber-300 font-bold tabular-nums">
                  ×{telemetry.combo}
                </span>
              )}
            </div>
            <div className="text-base font-bold text-white tabular-nums">
              {telemetry.score.toLocaleString()}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 pointer-events-auto">
            <button
              type="button"
              onClick={() => setPanelsVisible((v) => !v)}
              title="Show / Hide Panels (H)"
              className="apple-glass-panel hover:bg-white/15 px-3 py-2 rounded-xl text-[11px] font-semibold tracking-[0.06em] text-slate-100 cursor-pointer transition-all flex items-center gap-1.5 whitespace-nowrap"
            >
              {panelsVisible ? (
                <>
                  <EyeOff className="w-3.5 h-3.5 text-amber-200" />
                  <span className="hidden sm:inline">Hide Panels</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5 text-amber-200" />
                  <span>Show Panels</span>
                </>
              )}
            </button>

            <div
              className={`flex items-center gap-1.5 transition-all duration-300 ease-out ${
                panelsVisible
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 -translate-y-2 pointer-events-none'
              }`}
            >
              {!isSinking && !isAftermath && (
                <button
                  type="button"
                  onClick={onTogglePause}
                  title="Pause (Esc)"
                  className="apple-glass-panel hover:bg-white/15 p-2 rounded-xl text-amber-100 cursor-pointer transition-colors"
                >
                  <Pause className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onToggleMute}
                title="Mute / Unmute (M)"
                className="apple-glass-panel hover:bg-white/15 p-2 rounded-xl text-amber-100 cursor-pointer transition-colors"
              >
                {telemetry.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM BAR: SINKING / AFTERMATH CONTROLS vs COLLAPSIBLE HELM DOCK */}
      <div
        className={`transition-all duration-300 ease-out ${
          panelsVisible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-3 pointer-events-none'
        }`}
      >
        {isSinking ? (
          <div className="flex flex-col items-center gap-2">
            <div className="pointer-events-auto apple-glass-panel rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-center gap-1.5 max-w-[95vw]">
              <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-300/80 mr-1">
                Focus [S]:
              </span>
              {VESSEL_SPOTS.map((spot) => {
                const active = telemetry.focusSpotId === spot.id;
                return (
                  <button
                    key={spot.id}
                    type="button"
                    onClick={() => onFocusSpot(spot.id)}
                    className={`px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] uppercase rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                      active
                        ? 'apple-glass-gold text-amber-100'
                        : spot.category === 'interior'
                          ? 'apple-glass-subtle text-amber-200 hover:bg-white/15'
                          : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                    }`}
                  >
                    {spot.shortLabel}
                  </button>
                );
              })}
              <div className="h-4 w-[1px] bg-white/15 mx-1" />
              <button
                type="button"
                onClick={onSkipSinking}
                className="apple-glass-subtle hover:bg-white/15 flex items-center gap-1.5 px-3 py-1 rounded-xl text-slate-100 text-[10px] font-semibold tracking-[0.1em] uppercase transition-colors cursor-pointer whitespace-nowrap"
              >
                <FastForward className="w-3.5 h-3.5 text-amber-200" />
                Skip To Aftermath [Space]
              </button>
            </div>
            <div className="apple-glass-panel text-[10px] tracking-[0.12em] uppercase text-slate-200/85 px-3.5 py-1 rounded-xl">
              Drag Mouse to Orbit 360° · Scroll Wheel to Zoom · S to Focus Station
            </div>
          </div>
        ) : isAftermath ? (
          <div className="flex flex-col items-center gap-2">
            <div className="pointer-events-auto apple-glass-panel rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-center gap-2 max-w-[95vw]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-300/80 mr-0.5">
                  Focus:
                </span>
                <button
                  type="button"
                  onClick={() => onFocusAftermath('lifeboats')}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-semibold tracking-[0.1em] uppercase transition-all cursor-pointer whitespace-nowrap ${
                    telemetry.aftermathFocus === 'lifeboats'
                      ? 'apple-glass-gold text-amber-100'
                      : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                  }`}
                >
                  Lifeboat Cluster
                </button>
                <button
                  type="button"
                  onClick={() => onFocusAftermath('warship')}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-semibold tracking-[0.1em] uppercase transition-all cursor-pointer whitespace-nowrap ${
                    telemetry.aftermathFocus === 'warship'
                      ? 'apple-glass-gold text-amber-100'
                      : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                  }`}
                >
                  Escort Warships
                </button>
                {telemetry.activeSubmarines > 0 && (
                  <button
                    type="button"
                    onClick={() => onFocusAftermath('submarines')}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-semibold tracking-[0.1em] uppercase transition-all cursor-pointer whitespace-nowrap ${
                      telemetry.aftermathFocus === 'submarines'
                        ? 'apple-glass-danger text-red-50'
                        : 'apple-glass-subtle text-red-200 hover:bg-red-500/20'
                    }`}
                  >
                    U-Boats ({telemetry.activeSubmarines})
                  </button>
                )}
                {telemetry.carpathiaStage !== 'waiting' && (
                  <button
                    type="button"
                    onClick={() => onFocusAftermath('carpathia')}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-semibold tracking-[0.1em] uppercase transition-all cursor-pointer whitespace-nowrap ${
                      telemetry.aftermathFocus === 'carpathia'
                        ? 'apple-glass-gold text-amber-100'
                        : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                    }`}
                  >
                    RMS Carpathia
                  </button>
                )}
              </div>

              {telemetry.carpathiaStage === 'waiting' && (
                <button
                  type="button"
                  onClick={onFastForwardRescue}
                  className="apple-glass-subtle hover:bg-white/15 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sky-200 text-[10px] font-semibold tracking-[0.1em] uppercase transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FastForward className="w-3.5 h-3.5" />
                  Skip To Carpathia
                </button>
              )}
              <div className="h-4 w-[1px] bg-white/15" />
              <button
                type="button"
                onClick={onOpenReport}
                className="apple-glass-subtle hover:bg-white/15 px-3.5 py-1.5 rounded-xl text-amber-100 text-[11px] font-semibold tracking-[0.1em] uppercase transition-colors cursor-pointer whitespace-nowrap"
              >
                Voyage Report
              </button>
              <button
                type="button"
                onClick={onRestart}
                className="apple-glass-gold hover:brightness-110 px-4 py-1.5 rounded-xl text-amber-50 text-[11px] font-semibold tracking-[0.1em] uppercase transition-all cursor-pointer whitespace-nowrap"
              >
                Sail Again [Enter]
              </button>
            </div>
            <div className="apple-glass-panel text-[10px] tracking-[0.12em] uppercase text-slate-200/85 px-3.5 py-1 rounded-xl">
              {telemetry.carpathiaStage === 'waiting'
                ? telemetry.warshipRescuing
                  ? 'Drag Mouse to Orbit 360° · Scroll Wheel to Zoom · Escort Warship Boarding Lifeboats While Carpathia Approaches'
                  : 'Drag Mouse to Orbit 360° · Scroll Wheel to Zoom · Escort Warship Steaming In to Rescue Survivors'
                : telemetry.carpathiaStage === 'approaching'
                  ? 'Drag Mouse to Orbit 360° · Scroll Wheel to Zoom · RMS Carpathia Steaming Toward Survivors'
                  : telemetry.carpathiaStage === 'boarding'
                    ? 'Drag Mouse to Orbit 360° · Scroll Wheel to Zoom · Lifeboats Boarding Warship & Carpathia Ladders'
                    : 'Drag Mouse to Orbit 360° · Scroll Wheel to Zoom · All 712 Survivors Safely Aboard Warship & Carpathia'}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDockCollapsed((v) => !v)}
              className="pointer-events-auto apple-glass-panel hover:bg-white/15 flex items-center gap-1.5 px-3.5 py-1 rounded-xl text-[10px] font-semibold tracking-[0.12em] uppercase text-amber-100 cursor-pointer transition-colors whitespace-nowrap"
            >
              {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {dockCollapsed ? 'Expand Helm Dock' : 'Minimize Dock'}
            </button>

            {!dockCollapsed && (
              <div className="pointer-events-auto apple-glass-panel rounded-3xl px-5 py-3 flex flex-col items-center gap-2.5 max-w-[96vw]">
                <div className="flex flex-wrap items-center justify-center gap-3.5">
                  {/* Helm Rudder Control */}
                  <div className="flex items-center gap-2.5">
                    <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-200 w-20 text-right tabular-nums">
                      {telemetry.rudderDeg === 0
                        ? 'Amidships'
                        : telemetry.rudderDeg < 0
                          ? `Port ${Math.abs(telemetry.rudderDeg)}°`
                          : `Stbd ${telemetry.rudderDeg}°`}
                    </div>
                    <input
                      type="range"
                      min={-35}
                      max={35}
                      value={telemetry.rudderDeg}
                      onChange={(e) => onSetRudder(Number(e.target.value))}
                      onPointerUp={() => onSetRudder(null)}
                      aria-label="Helm Rudder Angle"
                      className="w-28 md:w-32 accent-amber-300 cursor-pointer"
                    />
                  </div>

                  <div className="hidden md:block h-5 w-[1px] bg-white/15" />

                  {/* Chadburn Engine Order Telegraph */}
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    {TELEGRAPH_NOTCHES.map((notch, idx) => {
                      const active = telemetry.telegraphIndex === idx;
                      return (
                        <button
                          key={notch.id}
                          type="button"
                          onClick={() => onSelectTelegraph?.(idx)}
                          className={`px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] uppercase rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                            active
                              ? 'apple-glass-gold text-amber-100'
                              : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                          }`}
                        >
                          {notch.shortLabel}
                        </button>
                      );
                    })}
                  </div>

                  <div className="hidden md:block h-5 w-[1px] bg-white/15" />

                  {/* Autopilot, Searchlight Sweep & Quick Helm/Ship Toggle */}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={onToggleAutopilot}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold tracking-[0.1em] uppercase transition-all cursor-pointer whitespace-nowrap ${
                        telemetry.autopilotEnabled
                          ? 'bg-emerald-400/25 border border-emerald-300/50 text-emerald-100 shadow-sm'
                          : 'apple-glass-subtle hover:bg-white/15 text-amber-100'
                      }`}
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      {telemetry.autopilotEnabled ? 'Autopilot On [A]' : 'Autopilot [A]'}
                    </button>

                    <button
                      type="button"
                      onClick={onTriggerSearchlight}
                      disabled={telemetry.searchlightActive || telemetry.searchlightCooldownPct > 0}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold tracking-[0.1em] uppercase transition-all whitespace-nowrap ${
                        telemetry.searchlightActive
                          ? 'bg-sky-200/30 border border-sky-200/60 text-white cursor-pointer'
                          : telemetry.searchlightCooldownPct > 0
                            ? 'apple-glass-subtle text-slate-400 cursor-not-allowed opacity-70'
                            : 'apple-glass-subtle hover:bg-white/15 text-amber-100 cursor-pointer'
                      }`}
                    >
                      <Search className="w-3.5 h-3.5" />
                      {telemetry.searchlightActive
                        ? 'Sweeping'
                        : telemetry.searchlightCooldownPct > 0
                          ? `Cooling ${Math.ceil(telemetry.searchlightCooldownPct * 8)}s`
                          : 'Searchlight [Space]'}
                    </button>

                    <button
                      type="button"
                      onClick={onToggleCamera}
                      className="apple-glass-subtle hover:bg-white/15 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-amber-100 text-[10px] font-semibold tracking-[0.1em] uppercase transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      {telemetry.focusSpotId === 'wheelhouse' ? 'Ship View [C]' : 'Helm View [C]'}
                    </button>
                  </div>
                </div>

                {/* Vessel Location & Accessible Interior Decks Selector */}
                <div className="w-full pt-2 border-t border-white/12 flex flex-col items-center gap-1.5">
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <span className="text-[9px] font-semibold tracking-[0.12em] uppercase text-slate-300/75 mr-0.5">
                      Exterior:
                    </span>
                    {VESSEL_SPOTS.filter((s) => s.category === 'exterior').map((spot) => {
                      const active = telemetry.focusSpotId === spot.id;
                      return (
                        <button
                          key={spot.id}
                          type="button"
                          onClick={() => onFocusSpot(spot.id)}
                          className={`px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                            active
                              ? 'apple-glass-gold text-amber-100'
                              : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                          }`}
                        >
                          {spot.shortLabel}
                        </button>
                      );
                    })}
                    <span className="hidden sm:inline text-white/20 mx-1">|</span>
                    <span className="text-[9px] font-semibold tracking-[0.12em] uppercase text-amber-200/85 mr-0.5">
                      Interior Decks:
                    </span>
                    {VESSEL_SPOTS.filter((s) => s.category === 'interior').map((spot) => {
                      const active = telemetry.focusSpotId === spot.id;
                      return (
                        <button
                          key={spot.id}
                          type="button"
                          onClick={() => onFocusSpot(spot.id)}
                          className={`px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                            active
                              ? 'apple-glass-gold text-amber-100'
                              : 'apple-glass-subtle text-amber-100/90 hover:bg-white/15'
                          }`}
                        >
                          {spot.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[9px] tracking-[0.11em] uppercase text-slate-300/75 text-center">
                    H Hide/Show Panels &nbsp;·&nbsp; A Autopilot &nbsp;·&nbsp; ← / → (Q / E) Rudder &nbsp;·&nbsp; W / X Telegraph &nbsp;·&nbsp; I / J / K / L Walk Deck &nbsp;·&nbsp; S Switch Deck &nbsp;·&nbsp; Drag Look
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
