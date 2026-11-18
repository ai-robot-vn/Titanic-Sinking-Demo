export type GamePhase =
  | 'title'
  | 'playing'
  | 'paused'
  | 'sinking'
  | 'victory'
  | 'gameover';

export type CameraMode = 'wheelhouse' | 'bridgeWing';

export type TelegraphNotch = 'ASTERN' | 'STOP' | 'SLOW' | 'HALF' | 'FULL' | 'FLANK';

export interface TelegraphSpec {
  id: TelegraphNotch;
  label: string;
  shortLabel: string;
  targetKnots: number;
  leverAngle: number; // radians on Chadburn dial
}

export const TELEGRAPH_NOTCHES: TelegraphSpec[] = [
  { id: 'ASTERN', label: 'FULL ASTERN', shortLabel: 'ASTERN', targetKnots: -8, leverAngle: -1.15 },
  { id: 'STOP', label: 'ALL STOP', shortLabel: 'STOP', targetKnots: 0, leverAngle: -0.68 },
  { id: 'SLOW', label: 'SLOW AHEAD', shortLabel: 'SLOW', targetKnots: 8, leverAngle: -0.22 },
  { id: 'HALF', label: 'HALF AHEAD', shortLabel: 'HALF', targetKnots: 14, leverAngle: 0.25 },
  { id: 'FULL', label: 'FULL AHEAD', shortLabel: 'FULL', targetKnots: 20, leverAngle: 0.72 },
  { id: 'FLANK', label: 'FLANK SPEED', shortLabel: 'FLANK', targetKnots: 24, leverAngle: 1.18 },
];

export type IcebergVariant = 'growler' | 'tabular' | 'pinnacle';

export interface TelemetrySnapshot {
  phase: GamePhase;
  cameraMode: CameraMode;
  headingDeg: number;
  rudderDeg: number; // -35 (Port) to +35 (Starboard)
  speedKnots: number;
  telegraphIndex: number;
  distanceNm: number;
  targetDistanceNm: number;
  hullIntegrity: number; // 0 to 100
  floodingPct: number; // 0 to 100
  waterIngressRate: number; // % per second
  compartmentsBreached: number; // 0 to 5
  sinkProgress: number; // 0 to 1 during sinking sequence
  score: number;
  bestScore: number;
  nearMissCount: number;
  combo: number;
  searchlightActive: boolean;
  searchlightCooldownPct: number; // 0 = ready, 1 = cooling
  icebergWarning: string | null;
  lastEventText: string | null;
  endlessMode: boolean;
  isMuted: boolean;
}

export const TARGET_VOYAGE_NM = 10.0;
