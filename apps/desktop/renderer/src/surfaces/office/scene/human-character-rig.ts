import type { RefObject } from 'react';
import type { Group } from 'three';

export type HumanAction = 'idle' | 'working' | 'active' | 'dragging';
export type HumanPosture = 'standing' | 'sitting';

/**
 * Six-head stylized-human proportions. The sitting offset resolves the hip to
 * the existing workstation chair seat while keeping the standing sole at y=0.
 */
export const HUMAN_DIMENSIONS = {
  modelScale: 0.76,
  hipY: 1.03,
  thigh: 0.5,
  shin: 0.47,
  pelvis: 0.21,
  torso: 0.62,
  upperArm: 0.39,
  forearm: 0.35,
  shoulderY: 0.51,
  headY: 0.84,
  sittingRootY: -0.293,
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
  rotate(rig.pelvis.current, 0, 0, slow * 0.012);
  rotate(rig.torso.current, -0.012, 0, -slow * 0.014);
  rotate(rig.head.current, 0.018, Math.sin(t * 0.36) * 0.16, -slow * 0.01);
  rotate(rig.leftHand.current, 0, 0, 0);
  rotate(rig.rightHand.current, 0, 0, 0);

  if (sitting) {
    rotate(rig.leftThigh.current, -1.4, 0.055, 0.025);
    rotate(rig.rightThigh.current, -1.4, -0.055, -0.025);
    rotate(rig.leftShin.current, 1.34 + slow * 0.018, 0, 0);
    rotate(rig.rightShin.current, 1.34 - slow * 0.018, 0, 0);
  } else {
    rotate(rig.leftThigh.current, slow * 0.014, 0, 0.02);
    rotate(rig.rightThigh.current, -slow * 0.014, 0, -0.02);
    rotate(rig.leftShin.current, Math.max(0, -slow) * 0.025, 0, 0);
    rotate(rig.rightShin.current, Math.max(0, slow) * 0.025, 0, 0);
  }
}

export function applyHumanPose(
  rig: HumanRigRefs,
  action: HumanAction,
  posture: HumanPosture,
  t: number,
): void {
  const sitting = posture === 'sitting' && action !== 'dragging';
  const slow = Math.sin(t * 1.35);
  const medium = Math.sin(t * 2.5);
  const fast = Math.sin(t * 8.2);
  neutralPose(rig, sitting, t);

  if (action === 'idle') {
    if (rig.root.current) {
      rig.root.current.position.y += Math.sin(t * 1.35) * (sitting ? 0.005 : 0.009);
    }
    if (sitting) {
      rotate(rig.torso.current, -0.07 + medium * 0.01, 0, slow * 0.012);
      rotate(rig.leftUpperArm.current, -0.25, 0.07, 0.1);
      rotate(rig.rightUpperArm.current, -0.25, -0.07, -0.1);
      rotate(rig.leftForearm.current, -0.58, 0.035, -0.04);
      rotate(rig.rightForearm.current, -0.58, -0.035, 0.04);
    } else {
      rotate(rig.leftUpperArm.current, -0.035 + slow * 0.02, 0, 0.065);
      rotate(rig.rightUpperArm.current, -0.035 - slow * 0.02, 0, -0.065);
      rotate(rig.leftForearm.current, 0.035, 0, -0.02);
      rotate(rig.rightForearm.current, 0.035, 0, 0.02);
    }
    return;
  }

  if (action === 'working') {
    if (rig.root.current) rig.root.current.position.y += Math.sin(t * 3.2) * 0.003;
    if (sitting) {
      rotate(rig.torso.current, -0.16 + medium * 0.008, 0, 0);
      rotate(rig.head.current, 0.17, medium * 0.02, 0);
      rotate(rig.leftUpperArm.current, -0.7, 0.11, 0.16);
      rotate(rig.rightUpperArm.current, -0.7, -0.11, -0.16);
      rotate(rig.leftForearm.current, -0.78 + fast * 0.035, 0.03, -0.07);
      rotate(rig.rightForearm.current, -0.78 - fast * 0.035, -0.03, 0.07);
      rotate(rig.leftHand.current, 0.06 + fast * 0.045, 0, 0.025);
      rotate(rig.rightHand.current, 0.06 - fast * 0.045, 0, -0.025);
    } else {
      rotate(rig.torso.current, -0.05, Math.sin(t * 0.8) * 0.05, 0);
      rotate(rig.head.current, 0.07, Math.sin(t * 0.82) * 0.09, 0);
      rotate(rig.leftUpperArm.current, -0.62 + medium * 0.065, 0.11, 0.24);
      rotate(rig.rightUpperArm.current, -0.88 - medium * 0.065, -0.11, -0.22);
      rotate(rig.leftForearm.current, -0.52, 0, -0.1);
      rotate(rig.rightForearm.current, -0.42, 0, 0.1);
    }
    return;
  }

  if (action === 'active') {
    if (rig.root.current) rig.root.current.position.y += Math.abs(Math.sin(t * 2.6)) * 0.011;
    rotate(rig.torso.current, -0.025, Math.sin(t * 0.7) * 0.035, -0.018);
    rotate(rig.head.current, -0.02, Math.sin(t * 0.8) * 0.05, 0.03);
    rotate(rig.leftUpperArm.current, -0.16, 0.05, 0.17);
    rotate(rig.leftForearm.current, -0.32, 0, -0.07);
    rotate(rig.rightUpperArm.current, -2.08, -0.07, -0.4);
    rotate(rig.rightForearm.current, -0.42, 0, 0.19 + Math.sin(t * 7.4) * 0.22);
    rotate(rig.rightHand.current, 0, Math.sin(t * 7.4) * 0.22, 0.1);
    return;
  }

  if (rig.root.current) {
    rig.root.current.position.y = 0.07 + Math.abs(Math.sin(t * 6.4)) * 0.04;
    rig.root.current.rotation.y = Math.sin(t * 2.7) * 0.1;
  }
  rotate(rig.pelvis.current, 0.07, 0, fast * 0.05);
  rotate(rig.torso.current, -0.07, 0, -fast * 0.035);
  rotate(rig.head.current, 0.07, medium * 0.07, fast * 0.025);
  rotate(rig.leftUpperArm.current, -1.3 + fast * 0.1, 0.09, 0.46);
  rotate(rig.rightUpperArm.current, -1.3 - fast * 0.1, -0.09, -0.46);
  rotate(rig.leftForearm.current, -0.52, 0, -0.16);
  rotate(rig.rightForearm.current, -0.52, 0, 0.16);
  rotate(rig.leftThigh.current, -0.38 + fast * 0.18, 0, 0.07);
  rotate(rig.rightThigh.current, 0.25 - fast * 0.18, 0, -0.07);
  rotate(rig.leftShin.current, 0.38, 0, 0);
  rotate(rig.rightShin.current, 0.48, 0, 0);
}
