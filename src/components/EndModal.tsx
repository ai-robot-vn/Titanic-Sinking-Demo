import React from 'react';
import { TelemetrySnapshot } from '../game/types';

interface EndModalProps {
  telemetry: TelemetrySnapshot;
  onRestart: () => void;
  onResume: () => void;
  onContinueEndless: () => void;
  onObserveAftermath: () => void;
  onReturnTitle: () => void;
}

export const EndModal: React.FC<EndModalProps> = ({
  telemetry,
  onRestart,
  onResume,
  onContinueEndless,
  onObserveAftermath,
  onReturnTitle,
}) => {
  const { phase } = telemetry;
  if (phase !== 'paused' && phase !== 'victory' && phase !== 'gameover') {
    return null;
  }

  const isPaused = phase === 'paused';
  const isVictory = phase === 'victory';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-6 bg-[#03070e]/72">
      <div className="bg-[#08101c] border border-[#c99c43]/65 rounded-sm max-w-md w-full p-7 text-center shadow-2xl">
        <div className="text-[10px] tracking-[0.26em] uppercase text-[#d8b467] font-semibold mb-2">
          {isPaused
            ? 'BRIDGE WATCH PAUSED'
            : isVictory
              ? 'OPEN WATER REACHED'
              : 'NORTH ATLANTIC · 41°43′N 49°56′W'}
        </div>

        <h2 className="font-maritime-serif text-3xl font-bold text-[#f4ebd2] tracking-wide mb-3">
          {isPaused ? 'Hold Course' : isVictory ? 'Safe Passage' : 'Voyage Log'}
        </h2>

        <p className="text-sm text-[#b9cbe0] mb-6 leading-relaxed">
          {isPaused
            ? 'Orders are standing by in the wheelhouse.'
            : isVictory
              ? 'You guided RMS Titanic cleanly past the North Atlantic ice barrier with hull integrity intact.'
              : telemetry.carpathiaStage === 'complete'
                ? `Titanic broke amidships and sank beneath the Atlantic, while the Royal Navy Escort Warships${telemetry.submarinesSunk > 0 ? ` sank ${telemetry.submarinesSunk} attacking submarine(s)` : ''} and RMS Carpathia rescued all 712 survivors from the 16 lifeboats.`
                : telemetry.carpathiaStage === 'boarding'
                  ? `Titanic sank beneath the Atlantic. Both the Escort Warships and RMS Carpathia are alongside with boarding ladders lowered (${telemetry.survivorsRescued} / 712 survivors aboard so far)${telemetry.submarinesSunk > 0 ? `, after driving off and sinking ${telemetry.submarinesSunk} hostile submarine(s)` : ''}.`
                  : telemetry.carpathiaStage === 'approaching'
                    ? `Titanic sank beneath the Atlantic. The Escort Warships have already brought ${telemetry.warshipSurvivors} survivors aboard while RMS Carpathia steams toward the remaining boats.`
                    : telemetry.warshipRescuing
                      ? `Titanic slipped beneath the waves. The following Escort Warships moved onto station and are rescuing lifeboats (${telemetry.warshipSurvivors} / 356 aboard) ahead of RMS Carpathia's arrival.`
                      : 'Titanic broke amidships and slipped beneath the freezing Atlantic while 16 lifeboats pulled away and the Escort Warships moved in to carry out a rescue.'}
        </p>

        {/* Voyage Summary Readout */}
        <div className="grid grid-cols-3 gap-2 mb-6 bg-[#050b14] border border-[#c99c43]/25 p-3 rounded-sm">
          <div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[#8ea4bd]">DISTANCE</div>
            <div className="text-base font-bold text-[#f4ebd2] tabular-nums">
              {telemetry.distanceNm.toFixed(1)} NM
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[#8ea4bd]">
              {phase === 'gameover' ? 'RESCUED' : 'NEAR MISSES'}
            </div>
            <div className="text-base font-bold text-[#e6c373] tabular-nums">
              {phase === 'gameover' ? `${telemetry.survivorsRescued} / 712` : telemetry.nearMissCount}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[#8ea4bd]">SCORE</div>
            <div className="text-base font-bold text-[#f4ebd2] tabular-nums">
              {telemetry.score.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5">
          {isPaused && (
            <button
              type="button"
              onClick={onResume}
              className="w-full py-3 bg-[#c99c43] hover:bg-[#dcb15a] text-[#08101c] font-bold tracking-[0.16em] uppercase text-xs rounded-sm cursor-pointer transition-colors"
            >
              RESUME WATCH [ESC]
            </button>
          )}

          {isVictory && (
            <button
              type="button"
              onClick={onContinueEndless}
              className="w-full py-3 bg-[#c99c43] hover:bg-[#dcb15a] text-[#08101c] font-bold tracking-[0.16em] uppercase text-xs rounded-sm cursor-pointer transition-colors"
            >
              CONTINUE ENDLESS NIGHT WATCH
            </button>
          )}

          <button
            type="button"
            onClick={onRestart}
            className={`w-full py-3 font-bold tracking-[0.16em] uppercase text-xs rounded-sm cursor-pointer transition-colors ${
              isPaused || isVictory
                ? 'bg-[#0e1b2e] hover:bg-[#162944] text-[#e6c373] border border-[#c99c43]/45'
                : 'bg-[#c99c43] hover:bg-[#dcb15a] text-[#08101c]'
            }`}
          >
            {isPaused ? 'RESTART VOYAGE' : 'SAIL AGAIN [ENTER]'}
          </button>

          {phase === 'gameover' && (
            <button
              type="button"
              onClick={onObserveAftermath}
              className="w-full py-2.5 bg-[#0e1b2e] hover:bg-[#162944] text-[#e6c373] border border-[#c99c43]/40 font-semibold tracking-[0.15em] uppercase text-[11px] rounded-sm cursor-pointer transition-colors"
            >
              RETURN TO OCEAN VIEW
            </button>
          )}

          <button
            type="button"
            onClick={onReturnTitle}
            className="w-full py-2.5 bg-transparent hover:bg-[#0e1b2e] text-[#9fb2c7] font-semibold tracking-[0.16em] uppercase text-[11px] rounded-sm cursor-pointer transition-colors"
          >
            RETURN TO BRIDGE TITLE
          </button>
        </div>
      </div>
    </div>
  );
};
