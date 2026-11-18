export type GamePhase =
  | 'title'
  | 'playing'
  | 'paused'
  | 'sinking'
  | 'aftermath'
  | 'victory'
  | 'gameover';

export type CameraMode = 'wheelhouse' | 'bridgeWing';

export type VesselSpotId =
  | 'wheelhouse'
  | 'bow'
  | 'crowsNest'
  | 'lifeboats'
  | 'funnels'
  | 'stern'
  | 'warship'
  | 'submarine'
  | 'staircase'
  | 'marconi'
  | 'lounge'
  | 'dining'
  | 'engine';

export interface VesselSpotSpec {
  id: VesselSpotId;
  category: 'exterior' | 'interior';
  label: string;
  shortLabel: string;
  localTarget: [number, number, number];
  defaultOrbitYaw: number;
  defaultOrbitPitch: number;
  defaultDistance: number;
  minDistance: number;
  walkBounds?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

export const VESSEL_SPOTS: VesselSpotSpec[] = [
  {
    id: 'wheelhouse',
    category: 'exterior',
    label: 'Wheelhouse Helm',
    shortLabel: 'HELM',
    localTarget: [0, 14.78, 1.32],
    defaultOrbitYaw: 0,
    defaultOrbitPitch: 0.085,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -3.6, maxX: 3.6, minZ: -1.1, maxZ: 2.3 },
  },
  {
    id: 'bow',
    category: 'exterior',
    label: 'Bow & Forecastle',
    shortLabel: 'BOW',
    localTarget: [0, 11.2, -56],
    defaultOrbitYaw: 0.45,
    defaultOrbitPitch: 0.16,
    defaultDistance: 36,
    minDistance: 0,
    walkBounds: { minX: -6.5, maxX: 6.5, minZ: -68, maxZ: -36 },
  },
  {
    id: 'crowsNest',
    category: 'exterior',
    label: "Crow's Nest Lookout",
    shortLabel: 'MAST',
    localTarget: [0, 26.8, -22.5],
    defaultOrbitYaw: 0.25,
    defaultOrbitPitch: 0.14,
    defaultDistance: 20,
    minDistance: 0,
  },
  {
    id: 'lifeboats',
    category: 'exterior',
    label: 'Boat Deck & Lifeboats',
    shortLabel: 'BOATS',
    localTarget: [12.5, 13.8, 28],
    defaultOrbitYaw: 1.05,
    defaultOrbitPitch: 0.18,
    defaultDistance: 38,
    minDistance: 0,
    walkBounds: { minX: -12.6, maxX: 12.6, minZ: 4, maxZ: 86 },
  },
  {
    id: 'funnels',
    category: 'exterior',
    label: 'Full 269m Ship & Funnels',
    shortLabel: 'SHIP',
    localTarget: [0, 19.0, 62],
    defaultOrbitYaw: 0.85,
    defaultOrbitPitch: 0.22,
    defaultDistance: 138,
    minDistance: 4,
  },
  {
    id: 'stern',
    category: 'exterior',
    label: 'Cruiser Stern & Propellers',
    shortLabel: 'STERN',
    localTarget: [0, 10.2, 180],
    defaultOrbitYaw: 2.55,
    defaultOrbitPitch: 0.2,
    defaultDistance: 46,
    minDistance: 0,
    walkBounds: { minX: -7.5, maxX: 7.5, minZ: 170, maxZ: 192 },
  },
  {
    id: 'warship',
    category: 'exterior',
    label: 'Royal Navy Escort Warships',
    shortLabel: 'WARSHIPS',
    localTarget: [0, 10.5, 0],
    defaultOrbitYaw: 0.58,
    defaultOrbitPitch: 0.16,
    defaultDistance: 96,
    minDistance: 6,
  },
  {
    id: 'submarine',
    category: 'exterior',
    label: 'Hostile U-Boat Submarines',
    shortLabel: 'U-BOATS',
    localTarget: [0, 4.0, 0],
    defaultOrbitYaw: 0.65,
    defaultOrbitPitch: 0.18,
    defaultDistance: 62,
    minDistance: 5,
  },
  {
    id: 'staircase',
    category: 'interior',
    label: 'Grand Staircase Atrium',
    shortLabel: 'STAIRS',
    localTarget: [0, 11.4, 36.2],
    defaultOrbitYaw: 0,
    defaultOrbitPitch: 0.12,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -4.8, maxX: 4.8, minZ: 28.6, maxZ: 38.0 },
  },
  {
    id: 'marconi',
    category: 'interior',
    label: 'Marconi Wireless & Gym',
    shortLabel: 'MARCONI',
    localTarget: [0, 14.3, 48.2],
    defaultOrbitYaw: 0.28,
    defaultOrbitPitch: 0.08,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -4.6, maxX: 4.6, minZ: 42.8, maxZ: 50.6 },
  },
  {
    id: 'lounge',
    category: 'interior',
    label: 'A-Deck Lounge & Promenade',
    shortLabel: 'LOUNGE',
    localTarget: [0, 11.35, 73.5],
    defaultOrbitYaw: 0.35,
    defaultOrbitPitch: 0.06,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -12.4, maxX: 12.4, minZ: 64.5, maxZ: 81.0 },
  },
  {
    id: 'dining',
    category: 'interior',
    label: 'D-Deck First Class Dining',
    shortLabel: 'DINING',
    localTarget: [0, 4.15, 53.0],
    defaultOrbitYaw: 0.22,
    defaultOrbitPitch: 0.07,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -10.5, maxX: 10.5, minZ: 41.0, maxZ: 64.5 },
  },
  {
    id: 'engine',
    category: 'interior',
    label: 'Reciprocating Engine Room',
    shortLabel: 'ENGINE',
    localTarget: [0, 2.2, 108.0],
    defaultOrbitYaw: 0.18,
    defaultOrbitPitch: 0.1,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -8.6, maxX: 8.6, minZ: 95.0, maxZ: 120.5 },
  },
];

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
export type CarpathiaStage = 'waiting' | 'approaching' | 'boarding' | 'complete';
export type AftermathFocusTarget = 'lifeboats' | 'warship' | 'carpathia' | 'submarines';

export interface TelemetrySnapshot {
  phase: GamePhase;
  cameraMode: CameraMode;
  focusSpotId: VesselSpotId;
  focusSpotLabel: string;
  focusSpotCategory: 'exterior' | 'interior';
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
  lifeboatsLaunched: number;
  aftermathSeconds: number;
  carpathiaStage: CarpathiaStage;
  carpathiaEtaSec: number;
  carpathiaDistanceM: number;
  survivorsRescued: number;
  boatsRecovered: number;
  warshipRescuing: boolean;
  warshipSurvivors: number;
  warshipBoatsRecovered: number;
  activeSubmarines: number;
  submarinesSunk: number;
  focusCarpathia: boolean;
  aftermathFocus: AftermathFocusTarget;
  inHarborZone: boolean;
  zoneLabel: string;
  score: number;
  bestScore: number;
  nearMissCount: number;
  combo: number;
  searchlightActive: boolean;
  searchlightCooldownPct: number; // 0 = ready, 1 = cooling
  icebergWarning: string | null;
  lastEventText: string | null;
  autopilotEnabled: boolean;
  bowPanicActive: boolean;
  endlessMode: boolean;
  isMuted: boolean;
}

export const TARGET_VOYAGE_NM = 10.0;
