import { Html } from '@react-three/drei';
import { MANAGER_PRESENCE_COLORS } from '../../lib/ceremony-visuals';

interface ManagerPresence3DProps {
  visible: boolean;
  position: [number, number, number] | null;
}

export function ManagerPresence3D({ visible, position }: ManagerPresence3DProps) {
  if (!visible || !position) return null;

  return (
    <Html position={[position[0], 1.8, position[2]]} center style={{ pointerEvents: 'none' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '9999px',
          background: MANAGER_PRESENCE_COLORS.bg,
          border: `1px solid ${MANAGER_PRESENCE_COLORS.border}`,
          color: MANAGER_PRESENCE_COLORS.text,
          boxShadow: `0 0 16px ${MANAGER_PRESENCE_COLORS.glow}`,
          fontSize: '9px',
          fontFamily: '"Geist Mono", "SF Mono", monospace',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            transform: 'rotate(45deg)',
            background: MANAGER_PRESENCE_COLORS.diamond,
            boxShadow: `0 0 10px ${MANAGER_PRESENCE_COLORS.diamondGlow}`,
            borderRadius: '2px',
            display: 'inline-block',
          }}
        />
        <span>Manager present</span>
      </div>
    </Html>
  );
}
