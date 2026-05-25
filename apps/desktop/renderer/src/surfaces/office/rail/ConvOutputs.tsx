import type { Deliverable, Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { cn } from '@/lib/utils.js';
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  Plus,
  Save,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';

const EXPORT_FORMATS = ['DOCX', 'PDF', 'PPTX', 'CSV', 'HTML', 'TXT'];
const MAX_FACES = 3;

interface ConvOutputsProps {
  deliverables: Deliverable[];
  employeesById: Map<string, Employee>;
}

function Contributors({
  ids,
  employeesById,
}: {
  ids: string[];
  employeesById: Map<string, Employee>;
}) {
  const faces = ids.slice(0, MAX_FACES);
  const overflow = ids.length - faces.length;
  return (
    <span className="off-dlv-contributors">
      {faces.map((id) => {
        const e = employeesById.get(id);
        if (!e) return null;
        return (
          <EmployeeAvatar
            key={id}
            seed={e.id}
            appearance={e.appearance}
            colorA={e.avatarA}
            colorB={e.avatarB}
            size={20}
            brand={e.kind === 'external'}
          />
        );
      })}
      {overflow > 0 ? <span className="off-dlv-more">+{overflow}</span> : null}
    </span>
  );
}

function DeliverableCard({
  deliverable,
  employeesById,
}: {
  deliverable: Deliverable;
  employeesById: Map<string, Employee>;
}) {
  const [open, setOpen] = useState(false);
  const canSaveSop = deliverable.contributorIds.length >= 2;

  return (
    <div className={cn('off-dlv', open && 'is-open')}>
      <button
        type="button"
        className="off-dlv-head off-focusable"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={FileCode2} size="sm" className="off-dlv-icon" />
        <span className="off-dlv-name">{deliverable.name}</span>
        {deliverable.format ? <span className="off-dlv-fmt">{deliverable.format}</span> : null}
        <Contributors ids={deliverable.contributorIds} employeesById={employeesById} />
        <Icon icon={ChevronDown} size="sm" className="off-dlv-caret" />
      </button>
      {open ? (
        <div className="off-dlv-body">
          {deliverable.preview ? (
            <pre className="off-dlv-preview">{deliverable.preview}</pre>
          ) : null}
          <div className="off-dlv-actions">
            <IconButton icon={Copy} label="Copy" variant="subtle" size="iconSm" />
            <IconButton icon={Download} label="Download" variant="subtle" size="iconSm" />
            <IconButton icon={Save} label="Save locally" variant="subtle" size="iconSm" />
            <IconButton icon={FolderOpen} label="Open folder" variant="subtle" size="iconSm" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="off-dlv-export off-focusable">
                  Export · {deliverable.format ?? 'DOCX'}
                  <Icon icon={ChevronDown} size="sm" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Export as</DropdownMenuLabel>
                {EXPORT_FORMATS.map((f) => (
                  <DropdownMenuItem key={f}>
                    {f}
                    {f === (deliverable.format ?? 'DOCX') ? (
                      <Check className="ml-auto size-[14px] text-[var(--off-accent)]" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {canSaveSop ? (
              <button type="button" className="off-dlv-sop off-focusable">
                <Icon icon={Sparkles} size="sm" />
                Save as SOP
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ConvOutputs({ deliverables, employeesById }: ConvOutputsProps) {
  if (deliverables.length === 0) return null;
  return (
    <section className="off-conv-outputs">
      <div className="off-rail-sec-head">
        Outputs
        <span className="off-rail-sec-count">{deliverables.length}</span>
        <span className="ml-auto">
          <IconButton icon={Plus} label="Add deliverable" variant="subtle" size="iconSm" />
        </span>
      </div>
      {deliverables.map((deliverable) => (
        <DeliverableCard
          key={deliverable.id}
          deliverable={deliverable}
          employeesById={employeesById}
        />
      ))}
    </section>
  );
}
