import { canonicalJson } from '../../testing/canonical-json.js';
import { sha256Text } from '../../testing/hash.js';
import type { LlmPlan } from '../pm-planner-types.js';

export interface PlanReviewPayload {
  readonly type: 'plan_review_payload';
  readonly planHash: string;
  readonly plan: LlmPlan;
}

export async function buildPlanReviewPayload(plan: LlmPlan): Promise<PlanReviewPayload> {
  return {
    type: 'plan_review_payload',
    planHash: await hashPlan(plan),
    plan,
  };
}

export async function parseReviewedPlanPayload(payload: unknown): Promise<LlmPlan | null> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const candidate = payload as Partial<PlanReviewPayload>;
  if (candidate.type !== 'plan_review_payload') return null;
  if (typeof candidate.planHash !== 'string') return null;
  if (!isLlmPlan(candidate.plan)) return null;
  const actualHash = await hashPlan(candidate.plan);
  return actualHash === candidate.planHash ? candidate.plan : null;
}

async function hashPlan(plan: LlmPlan): Promise<string> {
  return sha256Text(canonicalJson(plan));
}

function isLlmPlan(value: unknown): value is LlmPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Partial<LlmPlan>;
  if (typeof plan.summary !== 'string') return false;
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) return false;
  return plan.steps.every(isPlanStep);
}

function isPlanStep(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const step = value as Record<string, unknown>;
  if (typeof step.stepIndex !== 'number') return false;
  if (typeof step.description !== 'string') return false;
  if (!Array.isArray(step.tasks) || step.tasks.length === 0) return false;
  if (step.dependsOnSteps !== undefined && !isNumberArray(step.dependsOnSteps)) return false;
  return step.tasks.every(isPlanTask);
}

function isPlanTask(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const task = value as Record<string, unknown>;
  return (
    typeof task.taskType === 'string' &&
    typeof task.employeeId === 'string' &&
    typeof task.description === 'string' &&
    typeof task.dependsOnStepOutput === 'boolean' &&
    (task.requiredSkills === undefined || isStringArray(task.requiredSkills))
  );
}

function isNumberArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
