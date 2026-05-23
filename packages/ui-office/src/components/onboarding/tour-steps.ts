export type TourSlot =
  | 'settings:provider-cta'
  | 'office:project-selector'
  | 'office:chat-input'
  | 'office:tasks-tab'
  | 'personnel:nav-button'
  | 'market:nav-button';

export type TourWorkspace =
  | 'office'
  | 'sops'
  | 'market'
  | 'personnel'
  | 'workspace'
  | 'activity-log'
  | 'settings';

export interface TourStep {
  readonly id: string;
  readonly workspace: TourWorkspace;
  readonly slot: TourSlot;
  readonly title: string;
  readonly body: string;
  readonly primaryActionLabel?: string;
  readonly secondaryActionLabel?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'connect-provider',
    workspace: 'settings',
    slot: 'settings:provider-cta',
    title: 'Connect your AI provider',
    body: 'Open Settings and add an API key so the team can start working. We default to MiniMax — you can swap providers later.',
  },
  {
    id: 'pick-project',
    workspace: 'office',
    slot: 'office:project-selector',
    title: 'Pick or create a project',
    body: 'Projects scope conversations and bind a workspace folder. Pick one or create a new one to focus the team.',
  },
  {
    id: 'send-first-message',
    workspace: 'office',
    slot: 'office:chat-input',
    title: 'Send your first message',
    body: 'Describe the outcome you want. Team chat is the fastest way to kick work off — the boss will route it.',
  },
  {
    id: 'open-tasks',
    workspace: 'office',
    slot: 'office:tasks-tab',
    title: 'Open Tasks to watch progress',
    body: 'Tasks shows live activity, plan progress, and finished deliverables as the team works.',
  },
  {
    id: 'browse-personnel',
    workspace: 'personnel',
    slot: 'personnel:nav-button',
    title: 'Browse Personnel',
    body: 'Personnel is the roster: configure skills, runtime engines, and memory for each employee.',
  },
  {
    id: 'try-marketplace',
    workspace: 'market',
    slot: 'market:nav-button',
    title: 'Try the Marketplace',
    body: 'Market has shareable employees, skills, and templates. Install one to extend your team.',
  },
];
