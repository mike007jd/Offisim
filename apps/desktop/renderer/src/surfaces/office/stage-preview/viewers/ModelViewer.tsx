import { Icon } from '@/design-system/icons/Icon.js';
import { OrbitControls, Stage } from '@react-three/drei';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { Canvas } from '@react-three/fiber';
import { RotateCcw } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PreviewData } from '../preview-data.js';
import type { ResolvedPreviewTarget } from '../preview-target.js';
import { UnsupportedViewer } from './UnsupportedViewer.js';

type ModelState =
  | { status: 'loading' }
  | { status: 'ready'; scene: THREE.Object3D; label: string }
  | { status: 'error'; message: string };

function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}

function ModelScene({ scene, resetToken }: { scene: THREE.Object3D; resetToken: number }) {
  return (
    <>
      <Stage adjustCamera intensity={0.9} shadows={false} environment={null}>
        <primitive object={scene} />
      </Stage>
      <OrbitControls key={resetToken} makeDefault enableDamping dampingFactor={0.08} />
    </>
  );
}

export function ModelViewer({
  resolved,
  data,
}: {
  resolved: ResolvedPreviewTarget;
  data: Extract<PreviewData, { mode: 'bytes' }>;
}) {
  const [state, setState] = useState<ModelState>({ status: 'loading' });
  const [resetToken, setResetToken] = useState(0);
  const extension = resolved.meta.extension?.toLowerCase();
  const bytes = data.bytes;

  useEffect(() => {
    let cancelled = false;
    let scene: THREE.Object3D | null = null;
    setState({ status: 'loading' });
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    if (extension === 'vrm') {
      loader.register((parser) => new VRMLoaderPlugin(parser));
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    loader.parse(
      buffer,
      '',
      (gltf: GLTF) => {
        if (cancelled) {
          disposeObject(gltf.scene);
          return;
        }
        const vrm = gltf.userData.vrm as { scene?: THREE.Object3D } | undefined;
        scene = extension === 'vrm' && vrm?.scene ? vrm.scene : gltf.scene;
        setState({
          status: 'ready',
          scene,
          label: extension === 'vrm' && vrm?.scene ? 'VRM' : 'GLB/GLTF',
        });
      },
      (error) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      },
    );
    return () => {
      cancelled = true;
      if (scene) disposeObject(scene);
    };
  }, [bytes, extension]);

  if (state.status === 'loading') {
    return (
      <div className="off-stage-empty">
        <strong>Loading 3D model</strong>
        <span>Parsing mesh data and preparing the viewport.</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return <UnsupportedViewer resolved={resolved} data={{ mode: 'none', reason: state.message }} />;
  }

  return (
    <div className="off-model-viewer">
      <div className="off-preview-text-tools">
        <button type="button" onClick={() => setResetToken((value) => value + 1)}>
          <Icon icon={RotateCcw} size="sm" />
          Reset
        </button>
      </div>
      <div className="off-model-canvas">
        <Canvas camera={{ position: [0, 1.2, 4.5], fov: 38 }} dpr={[1, 2]}>
          <Suspense fallback={null}>
            <ModelScene scene={state.scene} resetToken={resetToken} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}
