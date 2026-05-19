import { OnboardingTour, TOUR_STEPS, type TourStep } from '@offisim/ui-office/web';
import { useMemo } from 'react';
import {
  completeTourStep,
  dismissTour,
  markCompany,
  uncompleteTourStep,
  useOnboardingState,
} from '../lib/onboarding-store';

const LAST_TOUR_STEP_ID = TOUR_STEPS[TOUR_STEPS.length - 1]?.id;

interface OnboardingControllerProps {
  activeCompanyId: string | null;
  isOfficeView: boolean;
  anyOverlayOpen: boolean;
  directChatActive: boolean;
  activeWorkspace?: TourStep['workspace'];
  onSwitchWorkspace: (workspace: TourStep['workspace']) => void;
}

export function OnboardingController({
  activeCompanyId,
  isOfficeView,
  anyOverlayOpen,
  directChatActive,
  activeWorkspace = 'office',
  onSwitchWorkspace,
}: OnboardingControllerProps) {
  const state = useOnboardingState();
  const completed = useMemo(() => {
    return new Set(state.account.tour_completed);
  }, [state.account.tour_completed]);

  return (
    <OnboardingTour
      activeWorkspace={activeWorkspace}
      completedStepIds={completed}
      dismissed={state.account.tour_dismissed}
      suppressed={anyOverlayOpen || (isOfficeView && directChatActive)}
      onDismiss={dismissTour}
      onBackStep={uncompleteTourStep}
      onSwitchWorkspace={onSwitchWorkspace}
      onCompleteStep={(stepId) => {
        completeTourStep(stepId);
        if (activeCompanyId && stepId === 'send-first-message') {
          markCompany(activeCompanyId, 'first_task_sent');
        }
        if (activeCompanyId && stepId === 'open-tasks') {
          markCompany(activeCompanyId, 'first_deliverable_seen');
        }
        if (stepId === LAST_TOUR_STEP_ID) dismissTour();
      }}
    />
  );
}
