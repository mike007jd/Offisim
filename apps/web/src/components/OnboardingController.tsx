import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type AccountOnboardingState,
  type CompanyOnboardingState,
  markAccount,
  markCompany,
  useCompanyOnboardingState,
  useOnboardingState,
} from '../lib/onboarding-store';

interface OnboardingControllerProps {
  activeCompanyId: string | null;
  isOfficeView: boolean;
  anyOverlayOpen: boolean;
  directChatActive: boolean;
}

type HintSlot = 'provider_configured' | 'first_task_sent' | 'first_deliverable_seen';

interface HintDescriptor {
  slot: HintSlot;
  selector: string;
  title: string;
  body: string;
  dismiss: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function pickActiveHint(
  account: AccountOnboardingState,
  company: CompanyOnboardingState,
  companyId: string | null,
  directChatActive: boolean,
): HintDescriptor | null {
  if (!account.provider_configured) {
    return {
      slot: 'provider_configured',
      selector: '[data-onboarding-target="configure-provider"]',
      title: 'Connect your AI provider',
      body: 'Open Settings and add an API key so the team can start working.',
      dismiss: () => markAccount('provider_configured'),
    };
  }
  if (!company.first_task_sent && companyId) {
    return {
      slot: 'first_task_sent',
      selector: '[data-onboarding-target="chat-input"]',
      title: 'Send your first task',
      body: 'Describe the outcome you want. Team chat is the fastest way to kick work off.',
      dismiss: () => markCompany(companyId, 'first_task_sent'),
    };
  }
  if (
    company.first_task_sent &&
    !company.first_deliverable_seen &&
    companyId &&
    !directChatActive
  ) {
    return {
      slot: 'first_deliverable_seen',
      selector: '[data-onboarding-target="tasks-tab"]',
      title: 'Open Tasks for progress and outputs',
      body: 'Tasks is where live activity, plan progress, and finished deliverables show up.',
      dismiss: () => markCompany(companyId, 'first_deliverable_seen'),
    };
  }
  return null;
}

function rectsEqual(a: TargetRect | null, b: TargetRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function useTargetRect(selector: string | null): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }

    function measure(): void {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (!selector) return;
        const el = document.querySelector(selector);
        if (!el) {
          setRect((prev) => (prev === null ? prev : null));
          return;
        }
        const r = el.getBoundingClientRect();
        const next: TargetRect = { top: r.top, left: r.left, width: r.width, height: r.height };
        setRect((prev) => (rectsEqual(prev, next) ? prev : next));
      });
    }

    measure();

    // Observe the target directly, not document.body — avoids measure() firing on
    // unrelated DOM mutations (chat streaming, scene updates, etc.).
    const el = document.querySelector(selector);
    const observer = new ResizeObserver(measure);
    if (el) observer.observe(el);

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { capture: true, passive: true });

    // Some targets (SceneCanvas, EmptyState) mount after a tick — retry once.
    const retry = window.setTimeout(measure, 250);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.clearTimeout(retry);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [selector]);

  return rect;
}

export function computeHintPosition(rect: TargetRect | null): React.CSSProperties {
  if (!rect) {
    return { left: '50%', bottom: 24, transform: 'translateX(-50%)' };
  }
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const cardWidth = 320;
  const gap = 12;
  const viewportPadding = 8;
  const estimatedCardHeight = 170;

  const placeAbove = rect.top > viewportH / 2;
  const left = Math.min(
    Math.max(viewportPadding, rect.left + rect.width / 2 - cardWidth / 2),
    viewportW - cardWidth - viewportPadding,
  );

  if (placeAbove) {
    return {
      left,
      bottom: Math.min(viewportH - viewportPadding, viewportH - rect.top + gap),
      width: cardWidth,
    };
  }
  return {
    left,
    top: Math.min(
      Math.max(viewportPadding, rect.top + rect.height + gap),
      viewportH - estimatedCardHeight - viewportPadding,
    ),
    width: cardWidth,
  };
}

function OnboardingControllerImpl({
  activeCompanyId,
  isOfficeView,
  anyOverlayOpen,
  directChatActive,
}: OnboardingControllerProps) {
  const state = useOnboardingState();
  const companyState = useCompanyOnboardingState(activeCompanyId);

  const hint =
    isOfficeView && !anyOverlayOpen
      ? pickActiveHint(state.account, companyState, activeCompanyId, directChatActive)
      : null;

  const targetRect = useTargetRect(hint?.selector ?? null);

  const position = useMemo(() => computeHintPosition(targetRect), [targetRect]);
  const ringStyle = useMemo<React.CSSProperties | null>(
    () =>
      targetRect
        ? {
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }
        : null,
    [targetRect],
  );

  if (!hint) return null;

  return (
    <>
      {ringStyle && (
        <div
          className="pointer-events-none fixed z-[70] rounded-xl ring-2 ring-cyan-400/70 shadow-[0_0_0_4px_rgba(34,211,238,0.15)] transition-all duration-200"
          style={ringStyle}
        />
      )}
      <div
        className="pointer-events-auto fixed z-[75] rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-sm"
        style={position}
        data-onboarding-hint={hint.slot}
      >
        <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-300/80">First Run Guide</p>
        <h2 className="mt-2 text-sm font-semibold text-white">{hint.title}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{hint.body}</p>
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            onClick={hint.dismiss}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10"
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}

export const OnboardingController = React.memo(OnboardingControllerImpl);
