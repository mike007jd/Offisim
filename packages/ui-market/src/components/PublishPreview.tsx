'use client';

import { KindIcon } from './KindIcon.js';
import { PermissionsPanel } from './PermissionsPanel.js';
import { RiskBadge } from './RiskBadge.js';

export interface PublishPreviewDraft {
  title: string;
  kind: string;
  summary: string;
  description: string;
  permissions?: {
    risk_class?: string;
    filesystem_scope?: string;
    network_scope?: string;
    declares_secrets?: boolean;
  };
  version?: string;
  tags?: string[];
}

export interface PublishPreviewProps {
  draft: PublishPreviewDraft;
}

export function PublishPreview({ draft }: PublishPreviewProps) {
  const displayVersion = draft.version ?? '1.0.0';

  return (
    <div className="space-y-6">
      {/* Card preview */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
          Listing card preview
        </p>
        <div className="max-w-xs rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <KindIcon kind={draft.kind} size={18} />
              <h3 className="font-semibold text-gray-900 line-clamp-1">
                {draft.title || 'Untitled'}
              </h3>
            </div>
            {draft.permissions?.risk_class && (
              <RiskBadge risk={draft.permissions.risk_class} />
            )}
          </div>

          <p className="mt-2 text-sm text-gray-600 line-clamp-2">
            {draft.summary || 'No summary provided.'}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>v{displayVersion}</span>
            {draft.tags && draft.tags.length > 0 && (
              <>
                <span className="text-gray-300">&middot;</span>
                {draft.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5">
                    {tag}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Detail page preview */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
          Detail page preview
        </p>
        <div className="rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <KindIcon kind={draft.kind} size={24} />
            <div>
              <h2 className="text-xl font-bold text-gray-900">{draft.title || 'Untitled'}</h2>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>v{displayVersion}</span>
                <span className="text-gray-300">&middot;</span>
                <span>{draft.kind || 'unknown kind'}</span>
              </div>
            </div>
          </div>

          {draft.summary && (
            <p className="mt-4 text-sm font-medium text-gray-700">{draft.summary}</p>
          )}

          {draft.description && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold text-gray-900">Description</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{draft.description}</p>
            </div>
          )}

          {draft.tags && draft.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {draft.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {draft.permissions && Object.keys(draft.permissions).length > 0 && (
            <div className="mt-6">
              <PermissionsPanel
                permissions={{
                  risk_class: draft.permissions.risk_class as
                    | 'data_asset'
                    | 'logic_asset'
                    | 'privileged_asset'
                    | undefined,
                  filesystem_scope: draft.permissions.filesystem_scope as
                    | 'none'
                    | 'workspace'
                    | 'project'
                    | 'custom_path'
                    | undefined,
                  network_scope: draft.permissions.network_scope as
                    | 'none'
                    | 'limited'
                    | 'unrestricted'
                    | undefined,
                  declares_secrets: draft.permissions.declares_secrets,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
