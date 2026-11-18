import React, { useEffect, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Compass,
  Droplets,
  FastForward,
  Pause,
  Search,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  TELEGRAPH_NOTCHES,
  TelemetrySnapshot,
  VESSEL_SPOTS,
  VesselSpotId,
} from '../game/types';

interface GameHUDProps {
  telemetry: TelemetrySnapshot;
  onSelectTelegraph: (idx: number) => void;
  onSetRudder: (deg: number | null) => void;
  onTriggerSearchlight: () => void;
  onToggleCamera: () => void;
  onFocusSpot: (spotId: VesselSpotId) => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onSkipSinking: () => void;
  onOpenReport: () => void;
  onRestart: () => void;
}

function getCardinalLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export const GameHUD: React.FC<GameHUDProps> = ({
  telemetry,
  onSelectTelegraph,
  onSetRudder,
  onTriggerSearchlight,
  onToggleCamera,
  onFocusSpot,
  onTogglePause,
  onToggleMute,
  onSkipSinking,
  onOpenReport,
  onRestart,
}) => {
  const [dockCollapsed, setDockCollapsed] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyH' && !e.repeat) {
        setDockCollapsed((prev) => !prev);
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
          : 'FINAL PLUNGE — VESSEL SINKING BENEATH WAVES';
  const hullPct = telemetry.hullIntegrity;
  const hullColor =
    hullPct > 60 ? '#34d399' : hullPct > 30 ? '#fbbf24' : '#ef4444';

  const floodPct = telemetry.floodingPct;
  const floodColor = floodPct > 75 ? '#ef4444' : '#38bdf8';

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 md:p-5">
      {/* TOP PERIMETER STATUS STRIP */}
      <div className="flex items-start justify-between gap-3">
        {/* Top-Left: Hull Watertight Compartments, Flooding Ingress & Voyage Progress */}
        <div className="bg-[#070e18]/88 border border-[#c99c43]/45 px-3.5 py-2.5 rounded-sm min-w-[215px]">
          <div className="flex items-center justify-between text-[10px] tracking-[0.18em] uppercase text-[#a9bdd4] mb-1.5">
            <span>WATERTIGHT HULL</span>
            <span className="font-bold tabular-nums" style={{ color: hullColor }}>
              {hullPct}%
            </span>
          </div>
          {/* 5 Watertight Compartment Segments */}
          <div className="grid grid-cols-5 gap-1 mb-2">
            {[0, 1, 2, 3, 4].map((idx) => {
              const compThreshold = (5 - idx) * 20;
              const intact = hullPct >= compThreshold - 10;
              return (
                <div
                  key={idx}
                  className="h-2 rounded-[1px]"
                  style={{
                    backgroundColor: intact ? hullColor : 'rgba(127, 29, 29, 0.55)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                />
              );
            })}
          </div>

          {/* Water Ingress / Flooding Meter */}
          {(floodPct > 0 || isSinking || isAftermath) && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-[10px] tracking-[0.14em] uppercase mb-1">
                <span className="flex items-center gap-1 text-[#93c5fd]">
                  <Droplets className="w-3 h-3" />
                  FLOODING
                </span>
                <span className="font-bold tabular-nums" style={{ color: floodColor }}>
                  {floodPct}%
                  {!isSinking && telemetry.waterIngressRate > 0 && ` (+${telemetry.waterIngressRate}%/s)`}
                </span>
              </div>
              <div className="h-1.5 w-full bg-[#0c1b2e] rounded-[1px] overflow-hidden border border-white/10">
                <div
                  className="h-full transition-all duration-150"
                  style={{ width: `${floodPct}%`, backgroundColor: floodColor }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-[#e7dcc0] tabular-nums">
            <span className="text-[#9fb2c7] uppercase tracking-wider text-[10px]">
              {telemetry.endlessMode ? 'ENDLESS WATCH' : 'ICE ALLEY'}
            </span>
            <span className="font-semibold">
              {telemetry.distanceNm.toFixed(1)}
              {!telemetry.endlessMode && ` / ${telemetry.targetDistanceNm.toFixed(0)} NM`}
              {telemetry.endlessMode && ' NM'}
            </span>
          </div>
        </div>

        {/* Top-Center: Compass Heading & Warning / Distress Banner */}
        <div className="flex flex-col items-center gap-2">
          <div className="bg-[#070e18]/88 border border-[#c99c43]/45 px-4 py-2 rounded-sm flex items-center gap-3">
            <Compass className="w-4 h-4 text-[#d8b467]" />
            <div className="text-sm font-bold tracking-[0.16em] text-[#f4ebd2] tabular-nums">
              {String(telemetry.headingDeg).padStart(3, '0')}° {getCardinalLabel(telemetry.headingDeg)}
            </div>
            <div className="h-3.5 w-[1px] bg-[#c99c43]/35" />
            <div className="text-xs font-semibold tracking-wider text-[#d8b467] tabular-nums">
              {telemetry.speedKnots} KTS
            </div>
          </div>

          {isSinking ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="bg-[#450a0a]/92 border border-[#ef4444]/85 px-4 py-1.5 rounded-sm text-[11px] font-bold tracking-[0.18em] uppercase text-[#fecaca]">
                ▲ {sinkingStageText}
              </div>
              <div className="bg-[#071526]/92 border border-[#c99c43]/65 px-3.5 py-1.5 rounded-sm text-[11px] font-bold tracking-[0.16em] uppercase text-[#f3d999] tabular-nums">
                LIFEBOATS LOWERED: {telemetry.lifeboatsLaunched} / 16
              </div>
            </div>
          ) : isAftermath ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="bg-[#070e18]/92 border border-[#c99c43]/65 px-4 py-1.5 rounded-sm text-[11px] font-bold tracking-[0.18em] uppercase text-[#e6c373]">
                RMS TITANIC LOST BENEATH THE ATLANTIC
              </div>
              <div className="bg-[#071526]/92 border border-[#c99c43]/50 px-3.5 py-1.5 rounded-sm text-[11px] font-bold tracking-[0.16em] uppercase text-[#c7d6e6] tabular-nums">
                LIFEBOATS ADRIFT: {telemetry.lifeboatsLaunched} / 16
              </div>
            </div>
          ) : (
            <>
              {telemetry.icebergWarning && (
                <div className="bg-[#450a0a]/92 border border-[#ef4444]/80 px-4 py-1.5 rounded-sm text-[11px] font-bold tracking-[0.2em] uppercase text-[#fecaca]">
                  ▲ {telemetry.icebergWarning}
                </div>
              )}

              {telemetry.lastEventText && !telemetry.icebergWarning && (
                <div className="bg-[#081526]/90 border border-[#c99c43]/60 px-4 py-1 rounded-sm text-[11px] font-semibold tracking-[0.16em] uppercase text-[#f3d999]">
                  {telemetry.lastEventText}
                </div>
              )}
            </>
          )}
        </div>

        {/* Top-Right: Score & Quick Actions */}
        <div className="flex items-start gap-2">
          <div className="bg-[#070e18]/88 border border-[#c99c43]/45 px-3.5 py-2 rounded-sm text-right">
            <div className="flex items-center justify-end gap-2 text-[10px] tracking-[0.18em] uppercase text-[#a9bdd4]">
              <span>SCORE</span>
              {telemetry.combo > 1 && (
                <span className="text-[#fbbf24] font-bold tabular-nums">
                  ×{telemetry.combo}
                </span>
              )}
            </div>
            <div className="text-base font-bold text-[#f4ebd2] tabular-nums">
              {telemetry.score.toLocaleString()}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 pointer-events-auto">
            {!isSinking && !isAftermath && (
              <button
                type="button"
                onClick={onTogglePause}
                title="Pause (Esc)"
                className="bg-[#070e18]/88 hover:bg-[#112036] border border-[#c99c43]/45 p-2 rounded-sm text-[#e6c373] cursor-pointer transition-colors"
              >
                <Pause className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onToggleMute}
              title="Mute / Unmute (M)"
              className="bg-[#070e18]/88 hover:bg-[#112036] border border-[#c99c43]/45 p-2 rounded-sm text-[#e6c373] cursor-pointer transition-colors"
            >
              {telemetry.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* BOTTOM BAR: SINKING / AFTERMATH CONTROLS vs COLLAPSIBLE HELM DOCK */}
      {isSinking ? (
        <div className="flex flex-col items-center gap-2">
          <div className="pointer-events-auto bg-[#070e18]/90 border border-[#c99c43]/50 rounded-sm px-3.5 py-2 flex flex-wrap items-center justify-center gap-2 max-w-[95vw]">
            <span className="text-[10px] tracking-[0.15em] uppercase text-[#9fb2c7] mr-1">
              FOCUS [S]:
            </span>
            {VESSEL_SPOTS.map((spot) => {
              const active = telemetry.focusSpotId === spot.id;
              return (
                <button
                  key={spot.id}
                  type="button"
                  onClick={() => onFocusSpot(spot.id)}
                  className={`px-2 py-1 text-[10px] font-bold tracking-[0.12em] uppercase rounded-[2px] border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#c99c43] text-[#08101c] border-[#e6c373]'
                      : 'bg-[#0b1626] text-[#c3d3e5] border-[#c99c43]/25 hover:border-[#c99c43]/60'
                  }`}
                >
                  {spot.shortLabel}
                </button>
              );
            })}
            <div className="h-4 w-[1px] bg-[#c99c43]/30 mx-1" />
            <button
              type="button"
              onClick={onSkipSinking}
              className="flex items-center gap-1.5 px-3 py-1 rounded-[2px] border bg-[#0b1626] hover:bg-[#14253d] text-[#c7d6e6] border-[#c99c43]/35 text-[10px] font-bold tracking-[0.14em] uppercase transition-colors cursor-pointer"
            >
              <FastForward className="w-3.5 h-3.5" />
              SKIP TO AFTERMATH [SPACE]
            </button>
          </div>
          <div className="text-[10px] tracking-[0.16em] uppercase text-[#a9bdd4]/85 bg-[#070e18]/75 px-3 py-0.5 rounded-sm">
            Drag Mouse to Orbit 360° · Scroll Wheel to Zoom · S to Focus Station
          </div>
        </div>
      ) : isAftermath ? (
        <div className="flex flex-col items-center gap-2">
          <div className="pointer-events-auto bg-[#070e18]/90 border border-[#c99c43]/55 rounded-sm px-4 py-2.5 flex flex-wrap items-center justify-center gap-2.5 max-w-[95vw]">
            <button
              type="button"
              onClick={onOpenReport}
              className="px-3.5 py-1.5 rounded-[2px] border bg-[#0b1626] hover:bg-[#14253d] text-[#e6c373] border-[#c99c43]/45 text-[11px] font-bold tracking-[0.14em] uppercase transition-colors cursor-pointer"
            >
              VOYAGE REPORT
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="px-4 py-1.5 rounded-[2px] bg-[#c99c43] hover:bg-[#dcb15a] text-[#08101c] text-[11px] font-bold tracking-[0.15em] uppercase transition-colors cursor-pointer"
            >
              SAIL AGAIN [ENTER]
            </button>
          </div>
          <div className="text-[10px] tracking-[0.16em] uppercase text-[#a9bdd4]/85 bg-[#070e18]/75 px-3 py-0.5 rounded-sm">
            Drag Mouse to Orbit 360° · Scroll Wheel to Zoom · Watch the 16 Lifeboats Adrift
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="pointer-events-auto flex items-center gap-1.5 bg-[#070e18]/90 hover:bg-[#112036] border border-b-0 border-[#c99c43]/45 px-3 py-1 rounded-t-sm text-[10px] tracking-[0.18em] uppercase text-[#d8b467] cursor-pointer transition-colors"
          >
            {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {dockCollapsed ? 'Show Bridge Controls' : 'Hide Controls'}
          </button>

          {!dockCollapsed && (
            <div className="pointer-events-auto bg-[#070e18]/90 border border-[#c99c43]/50 rounded-sm px-4 py-2.5 flex flex-col items-center gap-2 max-w-[96vw]">
              <div className="flex flex-wrap items-center justify-center gap-3.5">
                {/* Helm Rudder Control */}
                <div className="flex items-center gap-2.5">
                  <div className="text-[10px] tracking-[0.16em] uppercase text-[#a9bdd4] w-16 text-right tabular-nums">
                    {telemetry.rudderDeg === 0
                      ? 'AMIDSHIPS'
                      : telemetry.rudderDeg < 0
                        ? `PORT ${Math.abs(telemetry.rudderDeg)}°`
                        : `STBD ${telemetry.rudderDeg}°`}
                  </div>
                  <input
                    type="range"
                    min={-35}
                    max={35}
                    value={telemetry.rudderDeg}
                    onChange={(e) => onSetRudder(Number(e.target.value))}
                    onPointerUp={() => onSetRudder(null)}
                    aria-label="Helm Rudder Angle"
                    className="w-28 md:w-32 accent-[#c99c43] cursor-pointer"
                  />
                </div>

                <div className="hidden md:block h-5 w-[1px] bg-[#c99c43]/30" />

                {/* Chadburn Engine Order Telegraph */}
                <div className="flex items-center gap-1">
                  {TELEGRAPH_NOTCHES.map((notch, idx) => {
                    const active = telemetry.telegraphIndex === idx;
                    return (
                      <button
                        key={notch.id}
                        type="button"
                        onClick={() => onSelectTelegraph(idx)}
                        className={`px-2 py-1 text-[10px] font-bold tracking-[0.12em] uppercase rounded-[2px] border transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#c99c43] text-[#08101c] border-[#e6c373]'
                            : 'bg-[#0b1626] text-[#c3d3e5] border-[#c99c43]/25 hover:border-[#c99c43]/60'
                        }`}
                      >
                        {notch.shortLabel}
                      </button>
                    );
                  })}
                </div>

                <div className="hidden md:block h-5 w-[1px] bg-[#c99c43]/30" />

                {/* Searchlight Sweep & Quick Helm/Ship Toggle */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onTriggerSearchlight}
                    disabled={telemetry.searchlightActive || telemetry.searchlightCooldownPct > 0}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] border text-[10px] font-bold tracking-[0.14em] uppercase transition-colors cursor-pointer ${
                      telemetry.searchlightActive
                        ? 'bg-[#e0f2fe] text-[#08101c] border-[#bae6fd]'
                        : telemetry.searchlightCooldownPct > 0
                          ? 'bg-[#0b1626] text-[#64748b] border-[#334155] cursor-not-allowed'
                          : 'bg-[#0b1626] hover:bg-[#14253d] text-[#e6c373] border-[#c99c43]/50'
                    }`}
                  >
                    <Search className="w-3.5 h-3.5" />
                    {telemetry.searchlightActive
                      ? 'SWEEPING'
                      : telemetry.searchlightCooldownPct > 0
                        ? `COOLING ${Math.ceil(telemetry.searchlightCooldownPct * 8)}S`
                        : 'SEARCHLIGHT [SPACE]'}
                  </button>

                  <button
                    type="button"
                    onClick={onToggleCamera}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] border bg-[#0b1626] hover:bg-[#14253d] text-[#e6c373] border-[#c99c43]/50 text-[10px] font-bold tracking-[0.14em] uppercase transition-colors cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {telemetry.focusSpotId === 'wheelhouse' ? 'SHIP VIEW [C]' : 'HELM VIEW [C]'}
                  </button>
                </div>
              </div>

              {/* Vessel Location Focus Selector Row */}
              <div className="w-full pt-1.5 border-t border-[#c99c43]/20 flex flex-wrap items-center justify-center gap-1.5">
                <span className="text-[10px] tracking-[0.15em] uppercase text-[#9fb2c7] mr-1">
                  STATION [S]:
                </span>
                {VESSEL_SPOTS.map((spot) => {
                  const active = telemetry.focusSpotId === spot.id;
                  return (
                    <button
                      key={spot.id}
                      type="button"
                      onClick={() => onFocusSpot(spot.id)}
                      className={`px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] uppercase rounded-[2px] border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#c99c43] text-[#08101c] border-[#e6c373]'
                          : 'bg-[#0b1626] text-[#c3d3e5] border-[#c99c43]/25 hover:border-[#c99c43]/60'
                      }`}
                    >
                      {spot.shortLabel}
                    </button>
                  );
                })}
                <span className="hidden lg:inline text-[10px] tracking-[0.12em] uppercase text-[#88a0b8] ml-2">
                  · Drag Mouse to Orbit · Scroll to Zoom
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
