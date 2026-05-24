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
      <div className="grid min-h-first-run-welcome gap-6 md:grid-first-run-welcome">
        <div className="flex flex-col justify-center gap-4">
          <p className="max-w-2xl text-base leading-7 text-ink-3">
            Offisim gives you an AI team, a workspace, and a live office surface in one place. Start
            by connecting a provider, then create a project and send the team its first task.
          </p>
          <p className="max-w-2xl text-fs-sm leading-6 text-ink-4">
            The guide will highlight the exact controls you need; you can skip it and explore at any
            time.
          </p>
        </div>
        <div className="flex min-h-first-run-preview flex-col justify-between rounded-r-lg border border-line bg-surface-2 p-4">
          <div>
            <div className="h-10 w-10 rounded-r-md bg-accent-surface" />
            <div className="mt-6 h-3 w-32 rounded bg-border-subtle" />
            <div className="mt-3 h-2 w-48 rounded bg-border-muted" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-8 rounded-r-md border border-line-soft bg-surface-1" />
            <div className="h-8 rounded-r-md border border-line-soft bg-surface-1" />
            <div className="h-8 rounded-r-md border border-line-soft bg-surface-1" />
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
