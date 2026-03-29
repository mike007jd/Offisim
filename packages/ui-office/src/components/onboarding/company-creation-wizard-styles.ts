const KEYFRAMES_ID = 'wizard-keyframes';

export function ensureCompanyCreationWizardKeyframes() {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(KEYFRAMES_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
    @keyframes wiz-glow-pulse {
      0%, 100% { opacity: 0.2; }
      50% { opacity: 0.45; }
    }
    @keyframes wiz-idle-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-0.8px); }
    }
    @keyframes wiz-card-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes wiz-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes wiz-slide-up {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes wiz-building-pulse {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.08); opacity: 1; }
    }
    @keyframes wiz-cta-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
      50% { box-shadow: 0 0 20px 4px rgba(59, 130, 246, 0.15); }
    }
    @keyframes wiz-step-flow {
      from { width: 0; }
      to { width: 100%; }
    }
    @keyframes wiz-icon-glow {
      0%, 100% { filter: drop-shadow(0 0 6px currentColor); }
      50% { filter: drop-shadow(0 0 16px currentColor); }
    }
  `;
  document.head.appendChild(style);
}
