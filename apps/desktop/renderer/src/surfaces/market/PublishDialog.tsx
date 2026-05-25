import { FieldRow } from '@/design-system/grammar/FieldRow.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { cn } from '@/lib/utils.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { CloudUpload, Download, KeyRound, Sparkles, UserRound, X } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import type { PublishSource } from './market-data.js';

const SEMVER = /^\d+\.\d+\.\d+$/;

const schema = z.object({
  title: z.string().min(1, 'Required'),
  version: z.string().regex(SEMVER, 'Use semver, e.g. 0.1.0'),
  summary: z.string().min(1, 'Required'),
  readme: z.string().optional(),
  license: z.string().min(1),
  riskClass: z.string().min(1),
});
type PublishForm = z.infer<typeof schema>;

const LICENSES = [
  { value: 'MIT', label: 'MIT' },
  { value: 'Apache-2.0', label: 'Apache-2.0' },
  { value: 'CC-BY-4.0', label: 'CC-BY-4.0' },
  { value: 'proprietary', label: 'Proprietary' },
];
const RISK_CLASSES = [
  { value: 'data', label: 'Data asset' },
  { value: 'logic', label: 'Logic asset' },
  { value: 'system', label: 'System asset' },
];

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: PublishSource[];
}

export function PublishDialog({ open, onOpenChange, sources }: PublishDialogProps) {
  const employees = useMemo(() => sources.filter((s) => s.kind === 'employee'), [sources]);
  const skills = useMemo(() => sources.filter((s) => s.kind === 'skill'), [sources]);
  const showKindSelect = employees.length > 0 && skills.length > 0;

  const [kind, setKind] = useState<'employee' | 'skill'>(
    employees.length > 0 ? 'employee' : 'skill',
  );
  const sourceList = kind === 'employee' ? employees : skills;
  const [sourceId, setSourceId] = useState<string>(sourceList[0]?.id ?? '');
  const activeSource = sources.find((s) => s.id === sourceId) ?? sourceList[0];

  const [tags, setTags] = useState<string[]>(activeSource ? [activeSource.slug] : []);
  const [tagDraft, setTagDraft] = useState('');

  const form = useForm<PublishForm>({
    resolver: zodResolver(schema),
    values: {
      title: activeSource?.name ?? '',
      version: '0.1.0',
      summary: '',
      readme: '',
      license: 'MIT',
      riskClass: 'data',
    },
  });

  const onSubmit = form.handleSubmit(() => {
    toast.success('Draft queued for review · mod_9f3a21');
    onOpenChange(false);
  });

  function pickKind(next: 'employee' | 'skill') {
    setKind(next);
    const first = (next === 'employee' ? employees : skills)[0];
    if (first) {
      setSourceId(first.id);
      setTags([first.slug]);
    }
  }

  function pickSource(id: string) {
    setSourceId(id);
    const src = sources.find((s) => s.id === id);
    if (src) setTags([src.slug]);
  }

  function addTag(value: string) {
    const v = value.trim().toLowerCase();
    if (v && !tags.includes(v)) setTags((t) => [...t, v]);
    setTagDraft('');
  }
  function onTagKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagDraft);
    } else if (e.key === 'Backspace' && !tagDraft && tags.length > 0) {
      setTags((t) => t.slice(0, -1));
    }
  }

  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="off-mkt-dialog sm:max-w-[940px]">
        <DialogHeader>
          <DialogTitle>Publish To Market</DialogTitle>
          <DialogDescription>
            Build a package from an employee or a skill, then submit a registry draft with
            platform-verified artifact bytes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="off-pub-grid">
          <div className="off-pub-main">
            <FieldRow
              label={
                <span className="off-pub-token-l">
                  <Icon icon={KeyRound} size="sm" className="off-pub-token-i" />
                  Registry token
                </span>
              }
              hint="Publishing as @offisim-labs (Offisim Labs)"
            >
              {({ id }) => <Input id={id} placeholder="offisim_your_api_token" />}
            </FieldRow>

            {showKindSelect ? (
              <FieldRow label="Kind">
                {({ id }) => (
                  <Select
                    id={id}
                    value={kind}
                    onChange={(e) => pickKind(e.target.value as 'employee' | 'skill')}
                    options={[
                      { value: 'employee', label: 'Employee' },
                      { value: 'skill', label: 'Skill' },
                    ]}
                  />
                )}
              </FieldRow>
            ) : null}

            <FieldRow label="Source">
              {({ id }) => (
                <div className="off-src-picker" id={id}>
                  {sourceList.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={cn('off-src-opt off-focusable', s.id === sourceId && 'is-active')}
                      onClick={() => pickSource(s.id)}
                    >
                      <span className="off-src-i">
                        <Icon icon={s.kind === 'employee' ? UserRound : Sparkles} size="sm" />
                      </span>
                      <span className="off-src-c">
                        <span className="off-src-n">{s.name}</span>
                        <span className="off-src-d">{s.slug}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </FieldRow>

            <div className="off-pub-2col">
              <FieldRow label="Title" hint={errors.title?.message} warn={!!errors.title}>
                {({ id }) => <Input id={id} {...form.register('title')} />}
              </FieldRow>
              <FieldRow label="Version" hint={errors.version?.message} warn={!!errors.version}>
                {({ id }) => <Input id={id} {...form.register('version')} />}
              </FieldRow>
            </div>

            <FieldRow label="Summary" hint={errors.summary?.message} warn={!!errors.summary}>
              {({ id }) => (
                <Input
                  id={id}
                  placeholder="One-line marketplace summary"
                  {...form.register('summary')}
                />
              )}
            </FieldRow>

            <FieldRow label="Tags">
              {({ id }) => (
                <div className="off-taginput">
                  {tags.map((t) => (
                    <span key={t} className="off-tag">
                      {t}
                      <button
                        type="button"
                        aria-label={`Remove ${t}`}
                        onClick={() => setTags((cur) => cur.filter((x) => x !== t))}
                      >
                        <Icon icon={X} size="sm" />
                      </button>
                    </span>
                  ))}
                  <input
                    id={id}
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={onTagKey}
                    onBlur={() => addTag(tagDraft)}
                    placeholder={tags.length === 0 ? 'Add a tag…' : ''}
                  />
                </div>
              )}
            </FieldRow>

            <div className="off-pub-2col">
              <FieldRow label="License">
                {({ id }) => <Select id={id} options={LICENSES} {...form.register('license')} />}
              </FieldRow>
              <FieldRow label="Risk class">
                {({ id }) => (
                  <Select id={id} options={RISK_CLASSES} {...form.register('riskClass')} />
                )}
              </FieldRow>
            </div>

            <FieldRow label="Description / README">
              {({ id }) => (
                <Textarea
                  id={id}
                  placeholder="What this package includes, who it is for, and setup notes."
                  {...form.register('readme')}
                />
              )}
            </FieldRow>
          </div>

          <aside className="off-pub-aside">
            <div>
              <p className="off-pub-aside-l">Draft preview</p>
              <dl className="off-pub-preview">
                <div>
                  <dt>Title</dt>
                  <dd>{form.watch('title') || '—'}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd className="is-mono">{form.watch('version')}</dd>
                </div>
                <div>
                  <dt>Tags</dt>
                  <dd className="is-mono">{tags.join(', ') || '—'}</dd>
                </div>
              </dl>
            </div>
            <div>
              <p className="off-pub-aside-l">Recent drafts</p>
              <ul className="off-pub-recent">
                <li className="is-info">
                  <p>Competitive Teardown</p>
                  <p className="is-mono">submitted · pending</p>
                </li>
                <li className="is-err">
                  <p>QA Automation Lead</p>
                  <p className="is-mono">rejected · failed</p>
                </li>
              </ul>
            </div>
          </aside>

          <div className="off-pub-foot">
            <Button variant="outline" size="md" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="md"
              type="button"
              onClick={() => toast.success('Package bytes downloaded')}
            >
              <Icon icon={Download} size="sm" />
              Download package
            </Button>
            <Button size="md" type="submit">
              <Icon icon={CloudUpload} size="sm" />
              Submit draft
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
