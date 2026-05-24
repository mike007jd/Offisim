import { Button, DialogShell } from '@offisim/ui-core';

export function FirstRunWelcomeScreen({
  open,
  onGetStarted,
  onSkip,
}: {
  open: boolean;
  onGetStarted: () => void;
  onSkip: () => void;
}) {
  return (
    <DialogShell
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onSkip();
      }}
      stackId="first-run-welcome"
      size="xl"
      closeOnBackdrop={false}
      title="Offisim"
      description="Your AI office"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onSkip}>
            Skip and explore
          </Button>
          <Button type="button" onClick={onGetStarted}>
            Get started
          </Button>
        </>
      }
    >
      <div className="first-run-welcome">
        <div className="first-run-welcome-copy">
          <p data-slot="primary">
            Offisim gives you an AI team, a workspace, and a live office surface in one place. Start
            by connecting a provider, then create a project and send the team its first task.
          </p>
          <p data-slot="secondary">
            The guide will highlight the exact controls you need; you can skip it and explore at any
            time.
          </p>
        </div>
        <div className="first-run-preview">
          <div>
            <div data-slot="icon" />
            <div data-slot="line-strong" />
            <div data-slot="line-muted" />
          </div>
          <div data-slot="stack">
            <div />
            <div />
            <div />
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
