import { useEffect, useRef, useState } from 'react';
import { EndModal } from './components/EndModal';
import { GameHUD } from './components/GameHUD';
import { HarborOverlay } from './components/HarborOverlay';
import { TitleOverlay } from './components/TitleOverlay';
import { TitanicEngine } from './game/TitanicEngine';
import { TARGET_VOYAGE_NM, TelemetrySnapshot } from './game/types';

const INITIAL_TELEMETRY: TelemetrySnapshot = {
  phase: 'title',
  cameraMode: 'wheelhouse',
  focusSpotId: 'wheelhouse',
  focusSpotLabel: 'Wheelhouse Helm',
  headingDeg: 0,
  rudderDeg: 0,
  speedKnots: 0,
  telegraphIndex: 2,
  distanceNm: 0,
  targetDistanceNm: TARGET_VOYAGE_NM,
  hullIntegrity: 100,
  floodingPct: 0,
  waterIngressRate: 0,
  compartmentsBreached: 0,
  sinkProgress: 0,
  lifeboatsLaunched: 0,
  harborChapterIndex: 0,
  harborProgress: 0,
  harborAutoPlay: true,
  timeSkipProgress: 0,
  timeSkipDateLabel: 'APRIL 10, 1912 · SOUTHAMPTON',
  score: 0,
  bestScore: 0,
  nearMissCount: 0,
  combo: 1,
  searchlightActive: false,
  searchlightCooldownPct: 0,
  icebergWarning: null,
  lastEventText: null,
  endlessMode: false,
  isMuted: false,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<TitanicEngine | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(INITIAL_TELEMETRY);
  const [damageFlash, setDamageFlash] = useState(0);

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const engine = new TitanicEngine(
      mountEl,
      (snap) => setTelemetry(snap),
      (strength) => setDamageFlash(strength),
    );
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const showGameHud =
    telemetry.phase === 'playing' ||
    telemetry.phase === 'paused' ||
    telemetry.phase === 'sinking' ||
    telemetry.phase === 'victory' ||
    telemetry.phase === 'gameover';

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#050b14]">
      {/* Isolated WebGL Mount Container — React UI updates never tear down or re-render the canvas */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {/* Brief Crimson Impact Vignette on Iceberg Collision */}
      {damageFlash > 0.01 && (
        <div
          className="fixed inset-0 pointer-events-none z-20"
          style={{
            opacity: damageFlash * 0.65,
            background:
              'radial-gradient(circle at center, transparent 45%, rgba(185, 28, 28, 0.85) 100%)',
          }}
        />
      )}

      {telemetry.phase === 'title' && (
        <TitleOverlay
          bestScore={telemetry.bestScore}
          onStart={() => engineRef.current?.startHarborIntro()}
          onSkipToNight={() => engineRef.current?.startGame()}
        />
      )}

      {(telemetry.phase === 'harbor' || telemetry.phase === 'timeskip') && (
        <HarborOverlay
          telemetry={telemetry}
          onSelectChapter={(idx) => engineRef.current?.setHarborChapter(idx)}
          onPrevChapter={() => engineRef.current?.prevHarborChapter()}
          onNextChapter={() => engineRef.current?.nextHarborChapter()}
          onToggleAutoPlay={() => engineRef.current?.toggleHarborAutoPlay()}
          onSkipToNight={() => engineRef.current?.skipHarborToNight()}
          onToggleMute={() => engineRef.current?.toggleMute()}
        />
      )}

      {showGameHud && (
        <GameHUD
          telemetry={telemetry}
          onSelectTelegraph={(idx) => engineRef.current?.setTelegraphIndex(idx)}
          onSetRudder={(deg) => engineRef.current?.setManualRudder(deg)}
          onTriggerSearchlight={() => engineRef.current?.triggerSearchlight()}
          onToggleCamera={() => engineRef.current?.toggleCameraMode()}
          onFocusSpot={(spotId) => engineRef.current?.focusVesselSpot(spotId)}
          onTogglePause={() => engineRef.current?.togglePause()}
          onToggleMute={() => engineRef.current?.toggleMute()}
          onSkipSinking={() => engineRef.current?.skipSinking()}
        />
      )}

      <EndModal
        telemetry={telemetry}
        onRestart={() => engineRef.current?.startGame()}
        onResume={() => engineRef.current?.togglePause()}
        onContinueEndless={() => engineRef.current?.continueEndless()}
        onReturnTitle={() => engineRef.current?.returnToTitle()}
      />
    </main>
  );
}
