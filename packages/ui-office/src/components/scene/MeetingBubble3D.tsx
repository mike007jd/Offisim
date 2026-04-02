/**
 * MeetingBubble3D — glassmorphism overlay floating above the MTG zone.
 *
 * Shows ceremony progress text during orchestrated task lifecycle.
 * Positioned at [-10, 3, -8] (above MTG center).
 * Uses drei Html for DOM-in-3D rendering.
 */

import { Html } from '@react-three/drei';
import type { CeremonyState } from '../../hooks/useSceneOrchestrator';
import {
  DEFAULT_BUBBLE_TEXT,
  getPhaseColor,
  getPhaseIcon,
  prepareWaitingDisplay,
} from '../../lib/ceremony-visuals';

const BUBBLE_POSITION: [number, number, number] = [-10, 3, -8];

export function MeetingBubble3D({ ceremony }: { ceremony: CeremonyState }) {
  if (
    ceremony.phase === 'idle' ||
    (!ceremony.bubbleText && ceremony.waitingRelationships.length === 0)
  ) {
    return null;
  }

  const phaseIcon = getPhaseIcon(ceremony.phase);
  const phaseColor = getPhaseColor(ceremony.phase);
  const { visible: visibleRelationships, extraCount, labels } = prepareWaitingDisplay(ceremony.waitingRelationships);

  return (
    <Html position={BUBBLE_POSITION} center style={{ pointerEvents: 'none' }}>
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.60)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.10)',
          borderRadius: '12px',
          padding: '8px 16px',
          maxWidth: '280px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          transition: 'opacity 0.3s, transform 0.3s',
        }}
      >
        {/* Phase indicator dot */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: phaseColor,
              boxShadow: `0 0 8px ${phaseColor}`,
              animation: 'pulse 1.5s infinite',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: 'rgba(255, 255, 255, 0.90)',
              fontSize: '11px',
              fontWeight: 600,
              fontFamily: '"Geist Mono", "SF Mono", monospace',
              letterSpacing: '0.02em',
            }}
          >
            {phaseIcon} {ceremony.bubbleText || DEFAULT_BUBBLE_TEXT}
          </span>
        </div>
        {/* Participant count badge */}
        {ceremony.participantIds.size > 0 && (
          <div
            style={{
              marginTop: '4px',
              fontSize: '9px',
              color: 'rgba(255, 255, 255, 0.45)',
              fontFamily: '"Geist Mono", "SF Mono", monospace',
            }}
          >
            {ceremony.participantIds.size} participant{ceremony.participantIds.size > 1 ? 's' : ''}
            {ceremony.dispatchedIds.size > 0 && ` · ${ceremony.dispatchedIds.size} dispatched`}
          </div>
        )}
        {visibleRelationships.length > 0 && (
          <div
            style={{
              marginTop: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              fontSize: '9px',
              color: 'rgba(255,255,255,0.55)',
              fontFamily: '"Geist Mono", "SF Mono", monospace',
            }}
          >
            {visibleRelationships.map((relationship, i) => (
              <div key={`${relationship.waiterId}:${relationship.kind}`}>
                {labels[i]}
              </div>
            ))}
            {extraCount > 0 && <div>+{extraCount} more</div>}
          </div>
        )}
      </div>
    </Html>
  );
}
