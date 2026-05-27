export type BossRouteAction =
  | 'delegate'
  | 'direct_reply'
  | 'meeting'
  | 'hire_or_assess'
  | 'direct_delegate';

export interface BossRouteDecidedPayload {
  readonly action: BossRouteAction;
  readonly route: 'direct_reply' | 'delegate_manager' | 'start_meeting' | 'direct_delegate';
}
