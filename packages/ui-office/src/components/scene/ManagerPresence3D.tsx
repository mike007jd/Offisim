import { Html } from '@react-three/drei';

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
          background: 'rgba(245, 158, 11, 0.18)',
          border: '1px solid rgba(245, 158, 11, 0.42)',
          color: 'rgba(255, 248, 235, 0.92)',
          boxShadow: '0 0 16px rgba(245, 158, 11, 0.18)',
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
            background: 'rgba(251, 191, 36, 0.95)',
            boxShadow: '0 0 10px rgba(251, 191, 36, 0.55)',
            borderRadius: '2px',
            display: 'inline-block',
          }}
        />
        <span>Manager present</span>
      </div>
    </Html>
  );
}
