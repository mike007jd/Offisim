import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Chip } from '@/design-system/grammar/Chip.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  GitFork,
  Globe,
  HardDrive,
  KeyRound,
  Shield,
  Star,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type CSSProperties, useState } from 'react';
import { kindIcon } from './MarketCover.js';
import {
  INSTALLABLE_KINDS,
  type MarketListing,
  canInstallListing,
  getRarityTone,
} from './market-data.js';

interface MarketDetailProps {
  listing: MarketListing;
  installed: boolean;
  onClose: () => void;
  onInstall: () => void;
}

export function MarketDetail({ listing, installed, onClose, onInstall }: MarketDetailProps) {
  const tone = getRarityTone(listing.kind);
  const installable = INSTALLABLE_KINDS.has(listing.kind);
  const installAvailable = canInstallListing(listing);
  const [shot, setShot] = useState(0);
  const shots = listing.screenshots;
  const badgeIcon = kindIcon(listing.kind);

  return (
    <motion.aside
      className="off-md"
      style={{ '--rc': tone.rc, '--rcs': tone.rcs } as CSSProperties}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="off-md-head">
        <button type="button" className="off-md-back off-focusable" onClick={onClose}>
          <Icon icon={ArrowLeft} size="sm" />
          Back
        </button>
        <span className="off-md-kind">
          <Icon icon={badgeIcon} size="sm" />
          {listing.kind}
        </span>
        <button
          type="button"
          aria-label="Close"
          className="off-md-close off-focusable"
          onClick={onClose}
        >
          <Icon icon={X} size="sm" />
        </button>
      </header>

      <div className="off-md-body">
        <div>
          <h1 className="off-md-title">{listing.name}</h1>
          <p className="off-md-sum">{listing.summary}</p>
          <div className="off-md-handle-row">
            <span className="off-md-handle-h">@{listing.handle}</span>
            {listing.verified ? <span className="off-mc-vdot" /> : null}
            <span>·</span>
            <span>{listing.creatorName}</span>
          </div>
        </div>

        {shots.length > 0 ? (
          <div className="off-md-shots">
            <div className="off-md-frame">
              <img src={shots[shot]} alt="" />
              {shots.length > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label="Previous screenshot"
                    className="off-md-navb is-l off-focusable"
                    onClick={() => setShot((s) => (s - 1 + shots.length) % shots.length)}
                  >
                    <Icon icon={ChevronLeft} size="sm" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next screenshot"
                    className="off-md-navb is-r off-focusable"
                    onClick={() => setShot((s) => (s + 1) % shots.length)}
                  >
                    <Icon icon={ChevronRight} size="sm" />
                  </button>
                  <div className="off-md-dots">
                    {shots.map((src, i) => (
                      <i key={src} className={cn(i === shot && 'is-on')} />
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="off-md-tags">
          {listing.tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>

        <dl className="off-md-dl">
          <div>
            <div className="off-md-k">Version</div>
            <div className="off-md-v is-mono">{listing.version}</div>
          </div>
          <div>
            <div className="off-md-k">Installs</div>
            <div className="off-md-v is-mono">{listing.installs.toLocaleString()}</div>
          </div>
          <div>
            <div className="off-md-k">Rating</div>
            <div className="off-md-v">
              <Icon icon={Star} size="sm" className="off-icon-fill off-md-star" />
              {listing.rating.toFixed(1)}
            </div>
          </div>
          <div>
            <div className="off-md-k">Published</div>
            <div className="off-md-v is-mono">{listing.publishedLabel}</div>
          </div>
        </dl>

        {installable ? (
          installed ? (
            <div className="off-md-installed" aria-label="Installed package">
              <Icon icon={Check} size="sm" />
              Installed
            </div>
          ) : !installAvailable ? (
            <div className="off-md-unsupported">Not available to install yet.</div>
          ) : (
            <button type="button" className="off-md-install off-focusable" onClick={onInstall}>
              <Icon icon={Download} size="sm" />
              Install
            </button>
          )
        ) : (
          <div className="off-md-unsupported">Catalog only — not installable.</div>
        )}

        <div className="off-perm-box">
          <div className="off-perm-h">
            <Icon icon={Shield} size="sm" />
            Permissions
          </div>
          <PermRow icon={Shield} label="Risk" value={listing.permissions.risk} />
          <PermRow icon={HardDrive} label="Filesystem" value={listing.permissions.filesystem} />
          <PermRow icon={Globe} label="Network" value={listing.permissions.network} />
          <PermRow icon={KeyRound} label="Secrets" value={listing.permissions.secrets} />
        </div>

        <section className="off-md-sec">
          <CapsLabel>Description</CapsLabel>
          <p>{listing.description}</p>
        </section>

        {hasRequirements(listing) ? (
          <section className="off-md-sec">
            <CapsLabel>Requirements</CapsLabel>
            {listing.requirements.capabilities.length > 0 ? (
              <ReqRow label="Capabilities">
                {listing.requirements.capabilities.map((c) => (
                  <Chip key={c}>{c}</Chip>
                ))}
              </ReqRow>
            ) : null}
            {listing.requirements.mcps.length > 0 ? (
              <ReqRow label="MCPs">
                {listing.requirements.mcps.map((m) => (
                  <Chip key={m} className="off-chip-mono">
                    {m}
                  </Chip>
                ))}
              </ReqRow>
            ) : null}
            {listing.requirements.models.length > 0 ? (
              <ReqRow label="Models">
                {listing.requirements.models.map((m) => (
                  <Chip key={m} className="off-chip-mono">
                    {m}
                  </Chip>
                ))}
              </ReqRow>
            ) : null}
          </section>
        ) : null}

        <section className="off-md-sec">
          <CapsLabel>Lineage</CapsLabel>
          <div className="off-md-line">
            <span className="off-md-line-lbl">Origin</span>
            <span className="off-md-mono">{listing.lineage.origin}</span>
          </div>
          {listing.lineage.forkedFrom ? (
            <div className="off-md-line">
              <span className="off-md-line-lbl">
                <Icon icon={GitFork} size="sm" className="off-md-fork-i" /> Forked from
              </span>
              <span className="off-md-mono">{listing.lineage.forkedFrom}</span>
            </div>
          ) : null}
        </section>

        {listing.changelog.length > 0 ? (
          <section className="off-md-sec">
            <CapsLabel>Changelog</CapsLabel>
            <div className="off-cl">
              {listing.changelog.map((entry) => (
                <div key={entry.version} className="off-cl-ver">
                  <div className="off-cl-h">
                    <span className="off-cl-v">{entry.version}</span>
                    <span className="off-cl-d">{entry.date}</span>
                  </div>
                  <ul>
                    {entry.entries.map((e) => (
                      <li key={e.text} className={`is-${e.kind}`}>
                        {e.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="off-md-runtime">
          <span>Runtime</span>
          <span className="off-md-rt-v">{listing.requirements.runtime}</span>
        </div>
      </div>
    </motion.aside>
  );
}

function PermRow({
  icon,
  label,
  value,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
}) {
  return (
    <div className="off-perm-row">
      <span className="off-perm-k">
        <Icon icon={icon} size="sm" />
        {label}
      </span>
      <span className="off-perm-v">{value}</span>
    </div>
  );
}

function ReqRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="off-md-req-row">
      <span className="off-md-req-k">{label}</span>
      <span className="off-md-req-v">{children}</span>
    </div>
  );
}

function hasRequirements(l: MarketListing): boolean {
  return (
    l.requirements.capabilities.length > 0 ||
    l.requirements.mcps.length > 0 ||
    l.requirements.models.length > 0
  );
}
