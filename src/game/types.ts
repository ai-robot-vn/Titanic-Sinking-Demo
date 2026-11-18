export type GamePhase =
  | 'title'
  | 'harbor'
  | 'timeskip'
  | 'playing'
  | 'paused'
  | 'sinking'
  | 'victory'
  | 'gameover';

export type CameraMode = 'wheelhouse' | 'bridgeWing';

export type VesselSpotId =
  | 'wheelhouse'
  | 'bow'
  | 'crowsNest'
  | 'lifeboats'
  | 'funnels'
  | 'stern';

export interface VesselSpotSpec {
  id: VesselSpotId;
  label: string;
  shortLabel: string;
  localTarget: [number, number, number];
  defaultOrbitYaw: number;
  defaultOrbitPitch: number;
  defaultDistance: number;
}

export const VESSEL_SPOTS: VesselSpotSpec[] = [
  {
    id: 'wheelhouse',
    label: 'Wheelhouse Helm',
    shortLabel: 'HELM',
    localTarget: [0, 14.78, 1.32],
    defaultOrbitYaw: 0,
    defaultOrbitPitch: 0.085,
    defaultDistance: 0,
  },
  {
    id: 'bow',
    label: 'Bow & Forecastle',
    shortLabel: 'BOW',
    localTarget: [0, 11.2, -56],
    defaultOrbitYaw: 0.45,
    defaultOrbitPitch: 0.16,
    defaultDistance: 36,
  },
  {
    id: 'crowsNest',
    label: "Crow's Nest Lookout",
    shortLabel: 'MAST',
    localTarget: [0, 26.8, -22.5],
    defaultOrbitYaw: 0.25,
    defaultOrbitPitch: 0.14,
    defaultDistance: 20,
  },
  {
    id: 'lifeboats',
    label: 'Boat Deck & Lifeboats',
    shortLabel: 'BOATS',
    localTarget: [12.5, 13.8, 28],
    defaultOrbitYaw: 1.05,
    defaultOrbitPitch: 0.18,
    defaultDistance: 38,
  },
  {
    id: 'funnels',
    label: 'Full 269m Ship & Funnels',
    shortLabel: 'SHIP',
    localTarget: [0, 19.0, 62],
    defaultOrbitYaw: 0.85,
    defaultOrbitPitch: 0.22,
    defaultDistance: 138,
  },
  {
    id: 'stern',
    label: 'Cruiser Stern & Propellers',
    shortLabel: 'STERN',
    localTarget: [0, 10.2, 180],
    defaultOrbitYaw: 2.55,
    defaultOrbitPitch: 0.2,
    defaultDistance: 46,
  },
];

export interface HarborChapterSpec {
  id: string;
  shortTitle: string;
  title: string;
  kicker: string;
  description: string;
  controlsHint: string;
  focusSpotId: VesselSpotId;
  orbitYaw: number;
  orbitPitch: number;
  orbitDistance: number;
  startProgress: number;
  endProgress: number;
}

export const HARBOR_CHAPTERS: HarborChapterSpec[] = [
  {
    id: 'departure',
    shortTitle: '01 · Vessel',
    title: 'RMS Titanic — Southampton Berth 44',
    kicker: 'April 10, 1912 · 12:00 PM · Departure',
    description:
      'Spanning 269.1 meters in length and 28 meters across the beam, the 46,328-ton Olympic-class liner casts off past the Ocean Terminal cranes. Sixteen watertight hull compartments protect the lower decks.',
    controlsHint: 'Drag mouse anytime to orbit 360° · Scroll wheel to zoom in or out',
    focusSpotId: 'funnels',
    orbitYaw: -2.25,
    orbitPitch: 0.16,
    orbitDistance: 162,
    startProgress: 0.0,
    endProgress: 0.22,
  },
  {
    id: 'lifeboats',
    shortTitle: '02 · Boats',
    title: 'Boat Deck, Funnels & 16 Lifeboats',
    kicker: 'Olympic-Class Superstructure · Welin Davits',
    description:
      'Four 19.5-meter elliptical funnels vent the coal boilers while sixteen clinker-built 9.1-meter lifeboats hang in curved S-arm Welin davits along the 158-meter promenade superstructure.',
    controlsHint: 'Press S to cycle inspection stations along the ship',
    focusSpotId: 'lifeboats',
    orbitYaw: 0.22,
    orbitPitch: 0.16,
    orbitDistance: 38,
    startProgress: 0.22,
    endProgress: 0.44,
  },
  {
    id: 'lookout',
    shortTitle: '03 · Bow',
    title: "Forecastle, Razor Bow & Crow's Nest",
    kicker: 'Forward Well Deck · 42m Foremast',
    description:
      'Out on the 42-meter foremast stands the Crow’s Nest. At night, lookouts scan the dark horizon ahead of the razor bow and ring triple warning bells whenever drift ice or pack icebergs cross your course.',
    controlsHint: 'Listen for the lookout bell and watch for Ice Alley warnings',
    focusSpotId: 'crowsNest',
    orbitYaw: -2.35,
    orbitPitch: 0.08,
    orbitDistance: 34,
    startProgress: 0.44,
    endProgress: 0.65,
  },
  {
    id: 'bridge',
    shortTitle: '04 · Helm',
    title: 'Inside the Mahogany Wheelhouse',
    kicker: 'Command Station · Helm, Telegraph & Searchlight',
    description:
      'Steer the 101-ton rudder early using A / D (or Left / Right), adjust engine speed from Full Astern to Flank with the W / X Chadburn telegraph, and sweep the Spacebar roof searchlight to spot dark ice.',
    controlsHint: 'A / D Steer · W / X Telegraph · Space Searchlight · C Toggle View',
    focusSpotId: 'wheelhouse',
    orbitYaw: 0,
    orbitPitch: 0.085,
    orbitDistance: 0,
    startProgress: 0.65,
    endProgress: 0.86,
  },
  {
    id: 'breakwater',
    shortTitle: '05 · Sea',
    title: 'Clearing the Harbor Breakwater',
    kicker: 'Bound for New York · Into Open Water',
    description:
      'Titanic glides past the red-and-white harbor lighthouses into the English Channel. Ahead lies four days of smooth sailing—until the freezing moonlit night of April 14 in Ice Alley.',
    controlsHint: 'Clearing the mouth of Southampton Water — fast-forwarding to night',
    focusSpotId: 'bow',
    orbitYaw: -0.68,
    orbitPitch: 0.18,
    orbitDistance: 68,
    startProgress: 0.86,
    endProgress: 1.0,
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

export interface TelemetrySnapshot {
  phase: GamePhase;
  cameraMode: CameraMode;
  focusSpotId: VesselSpotId;
  focusSpotLabel: string;
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
  harborChapterIndex: number;
  harborProgress: number;
  harborAutoPlay: boolean;
  timeSkipProgress: number;
  timeSkipDateLabel: string;
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
