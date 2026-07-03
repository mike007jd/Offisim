import {
  type CapabilityStatus,
  type ThreadCapability,
  useThreadCapabilities,
} from '@/assistant/runtime/use-thread-capabilities.js';
import { StatusPill } from '@/design-system/grammar/StatusPill.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/design-system/primitives/popover.js';
import { Boxes } from 'lucide-react';

/**
 * Per-thread capability manifest surfaced as a compact composer pitbar chip →
 * popover. Answers "what can this teammate do here?" with a grouped, read-only
 * list: what is available now, and what needs setup (with the real route to fix
 * it). It never grants or executes — {@link useThreadCapabilities} owns the
 * status resolution and setup routing.
 */

const STATUS_TONE: Record<CapabilityStatus, 'ok' | 'warn' | 'muted'> = {
  available: 'ok',
  'needs-setup': 'warn',
  disabled: 'muted',
  unavailable: 'muted',
};

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  available: 'Ready',
  'needs-setup': 'Needs setup',
  disabled: 'Disabled',
  unavailable: 'Unavailable',
};

function CapabilityRow({ capability }: { capability: ThreadCapability }) {
  return (
    <div className="off-cap-row">
      <span className="off-cap-row-glyph">
        <Icon icon={capability.icon} size="sm" />
      </span>
      <div className="off-cap-row-main">
        <span className="off-cap-row-label">{capability.label}</span>
        <StatusPill tone={STATUS_TONE[capability.status]}>
          {STATUS_LABEL[capability.status]}
        </StatusPill>
      </div>
      <div className="off-cap-row-aside">
        {capability.setup ? (
          <Button variant="subtle" size="sm" onClick={capability.setup.action}>
            {capability.setup.label}
          </Button>
        ) : (
          <span className="off-cap-row-source">{capability.source}</span>
        )}
      </div>
      <p className="off-cap-row-detail">{capability.detail}</p>
    </div>
  );
}

function CapabilitySection({
  title,
  capabilities,
}: {
  title: string;
  capabilities: ThreadCapability[];
}) {
  if (capabilities.length === 0) return null;
  return (
    <section className="off-cap-manifest-sec">
      <div className="off-rail-sec-head">
        {title}
        <span className="off-rail-sec-count">{capabilities.length}</span>
      </div>
      {capabilities.map((capability) => (
        <CapabilityRow key={capability.id} capability={capability} />
      ))}
    </section>
  );
}

export function CapabilityManifest({
  threadId,
  employeeId,
}: {
  threadId: string;
  /** The thread's acting employee (null for a whole-team thread). */
  employeeId: string | null;
}) {
  const capabilities = useThreadCapabilities(threadId, employeeId);
  const available = capabilities.filter((capability) => capability.status === 'available');
  const pending = capabilities.filter((capability) => capability.status !== 'available');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="off-thread-pit off-focusable"
          title="What this teammate can do in this thread"
        >
          <Icon icon={Boxes} size="sm" />
          Capabilities
          <span className="off-thread-pit-count">{available.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="off-thread-pit-pop" align="start">
        <div className="off-cap-manifest">
          <CapabilitySection title="Available" capabilities={available} />
          <CapabilitySection title="Needs setup" capabilities={pending} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
