import type { RefObject } from 'react';
import type { Group } from 'three';

export type HumanAction = 'idle' | 'working' | 'active' | 'dragging';
export type HumanPosture = 'standing' | 'sitting';

export const HUMAN_DIMENSIONS = {
  modelScale: 0.74,
  hipY: 0.94,
  thigh: 0.44,
  shin: 0.42,
  pelvis: 0.2,
  torso: 0.56,
  upperArm: 0.34,
  forearm: 0.31,
  shoulderY: 0.46,
  headY: 0.88,
  sittingRootY: -0.19,
} as const;

export interface HumanRigRefs {
  readonly root: RefObject<Group | null>;
  readonly pelvis: RefObject<Group | null>;
  readonly torso: RefObject<Group | null>;
  readonly head: RefObject<Group | null>;
  readonly leftUpperArm: RefObject<Group | null>;
  readonly rightUpperArm: RefObject<Group | null>;
  readonly leftForearm: RefObject<Group | null>;
  readonly rightForearm: RefObject<Group | null>;
  readonly leftHand: RefObject<Group | null>;
  readonly rightHand: RefObject<Group | null>;
  readonly leftThigh: RefObject<Group | null>;
  readonly rightThigh: RefObject<Group | null>;
  readonly leftShin: RefObject<Group | null>;
  readonly rightShin: RefObject<Group | null>;
}

function rotate(group: Group | null, x: number, y: number, z: number): void {
  group?.rotation.set(x, y, z);
}

function neutralPose(rig: HumanRigRefs, sitting: boolean, t: number): void {
  const slow = Math.sin(t * 1.35);
  rig.root.current?.position.set(0, sitting ? HUMAN_DIMENSIONS.sittingRootY : 0, 0);
  rig.root.current?.rotation.set(0, 0, 0);
  rotate(rig.pelvis.current, 0, 0, slow * 0.015);
  rotate(rig.torso.current, -0.015, 0, -slow * 0.018);
  rotate(rig.head.current, 0.02, Math.sin(t * 0.36) * 0.18, -slow * 0.012);

  if (sitting) {
    rotate(rig.leftThigh.current, -1.36, 0.06, 0.03);
    rotate(rig.rightThigh.current, -1.36, -0.06, -0.03);
    rotate(rig.leftShin.current, 1.28 + slow * 0.025, 0, 0);
    rotate(rig.rightShin.current, 1.28 - slow * 0.025, 0, 0);
  } else {
    rotate(rig.leftThigh.current, slow * 0.018, 0, 0.025);
    rotate(rig.rightThigh.current, -slow * 0.018, 0, -0.025);
    rotate(rig.leftShin.current, Math.max(0, -slow) * 0.035, 0, 0);
    rotate(rig.rightShin.current, Math.max(0, slow) * 0.035, 0, 0);
  }
}

export function applyHumanPose(rig: HumanRigRefs, action: HumanAction, posture: HumanPosture, t: number): void {
  const sitting = posture === 'sitting' && action !== 'dragging';
  const slow = Math.sin(t * 1.35);
  const medium = Math.sin(t * 2.5);
  const fast = Math.sin(t * 8.2);
  neutralPose(rig, sitting, t);

  if (action === 'idle') {
    if (rig.root.current) rig.root.current.position.y += Math.sin(t * 1.35) * (sitting ? 0.007 : 0.012);
    if (sitting) {
      rotate(rig.torso.current, -0.08 + medium * 0.012, 0, slow * 0.015);
      rotate(rig.leftUpperArm.current, -0.28, 0.08, 0.12);
      rotate(rig.rightUpperArm.current, -0.28, -0.08, -0.12);
      rotate(rig.leftForearm.current, -0.62, 0.04, -0.05);
      rotate(rig.rightForearm.current, -0.62, -0.04, 0.05);
    } else {
      rotate(rig.leftUpperArm.current, -0.04 + slow * 0.025, 0, 0.08);
      rotate(rig.rightUpperArm.current, -0.04 - slow * 0.025, 0, -0.08);
      rotate(rig.leftForearm.current, 0.04, 0, -0.025);
      rotate(rig.rightForearm.current, 0.04, 0, 0.025);
    }
    return;
  }

  if (action === 'working') {
    if (rig.root.current) rig.root.current.position.y += Math.sin(t * 3.2) * 0.004;
    if (sitting) {
      rotate(rig.torso.current, -0.18 + medium * 0.01, 0, 0);
      rotate(rig.head.current, 0.2, medium * 0.025, 0);
      rotate(rig.leftUpperArm.current, -0.76, 0.12, 0.18);
      rotate(rig.rightUpperArm.current, -0.76, -0.12, -0.18);
      rotate(rig.leftForearm.current, -0.68 + fast * 0.05, 0.04, -0.08);
      rotate(rig.rightForearm.current, -0.68 - fast * 0.05, -0.04, 0.08);
      rotate(rig.leftHand.current, 0.08 + fast * 0.06, 0, 0.03);
      rotate(rig.rightHand.current, 0.08 - fast * 0.06, 0, -0.03);
    } else {
      rotate(rig.torso.current, -0.06, Math.sin(t * 0.8) * 0.06, 0);
      rotate(rig.head.current, 0.08, Math.sin(t * 0.82) * 0.1, 0);
      rotate(rig.leftUpperArm.current, -0.68 + medium * 0.08, 0.12, 0.28);
      rotate(rig.rightUpperArm.current, -0.94 - medium * 0.08, -0.12, -0.25);
      rotate(rig.leftForearm.current, -0.56, 0, -0.12);
      rotate(rig.rightForearm.current, -0.45, 0, 0.12);
    }
    return;
  }

  if (action === 'active') {
    if (rig.root.current) rig.root.current.position.y += Math.abs(Math.sin(t * 2.6)) * 0.014;
    rotate(rig.torso.current, -0.03, Math.sin(t * 0.7) * 0.04, -0.02);
    rotate(rig.head.current, -0.025, Math.sin(t * 0.8) * 0.06, 0.035);
    rotate(rig.leftUpperArm.current, -0.18, 0.06, 0.2);
    rotate(rig.leftForearm.current, -0.35, 0, -0.08);
    rotate(rig.rightUpperArm.current, -2.15, -0.08, -0.46);
    rotate(rig.rightForearm.current, -0.45, 0, 0.22 + Math.sin(t * 7.4) * 0.25);
    rotate(rig.rightHand.current, 0, Math.sin(t * 7.4) * 0.25, 0.12);
    return;
  }

  if (rig.root.current) {
    rig.root.current.position.y = 0.08 + Math.abs(Math.sin(t * 6.4)) * 0.045;
    rig.root.current.rotation.y = Math.sin(t * 2.7) * 0.12;
  }
  rotate(rig.pelvis.current, 0.08, 0, fast * 0.06);
  rotate(rig.torso.current, -0.08, 0, -fast * 0.04);
  rotate(rig.head.current, 0.08, medium * 0.08, fast * 0.03);
  rotate(rig.leftUpperArm.current, -1.35 + fast * 0.12, 0.1, 0.52);
  rotate(rig.rightUpperArm.current, -1.35 - fast * 0.12, -0.1, -0.52);
  rotate(rig.leftForearm.current, -0.55, 0, -0.18);
  rotate(rig.rightForearm.current, -0.55, 0, 0.18);
  rotate(rig.leftThigh.current, -0.42 + fast * 0.22, 0, 0.08);
  rotate(rig.rightThigh.current, 0.28 - fast * 0.22, 0, -0.08);
  rotate(rig.leftShin.current, 0.42, 0, 0);
  rotate(rig.rightShin.current, 0.52, 0, 0);
}
