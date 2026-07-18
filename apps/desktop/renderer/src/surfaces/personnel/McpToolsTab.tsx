import { useUiState } from '@/app/ui-state.js';
import { useEmployeeMcpTools } from '@/data/queries.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { ShieldCheck, Wrench, Zap } from 'lucide-react';

interface McpToolsTabProps {
  employeeId: string;
}

export function McpToolsTab({ employeeId }: McpToolsTabProps) {
  const tools = useEmployeeMcpTools(employeeId);
  const openSettings = useUiState((state) => state.openSettings);

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll">
        <CapsLabel>Connected tools</CapsLabel>
        {tools.isError ? (
          <ErrorState
            title="Couldn't load MCP tools"
            detail={errorDetail(tools.error, 'MCP tools could not be loaded.')}
            onRetry={() => void tools.refetch()}
          />
        ) : tools.isLoading ? (
          <SkeletonRows rows={3} />
        ) : !tools.data?.length ? (
          <EmptyState
            icon={Wrench}
            title="No connected tools"
            description="Connect a tool service, then choose which tools this employee can use."
            action={{ label: 'Open tool settings', onClick: () => openSettings('mcp') }}
          />
        ) : (
          tools.data.map((tool) => (
            <div key={tool.id} className="off-pers-skrow">
              <Icon icon={Wrench} size="sm" />
              <div className="off-pers-skrow-main">
                <div className="off-pers-skrow-top">
                  <span className="off-pers-skrow-name">{tool.title}</span>
                  <span className="off-pers-scope-tag">{tool.serverName}</span>
                  <span
                    className={
                      tool.readOnly ? 'off-pers-tool-tag is-read' : 'off-pers-tool-tag is-write'
                    }
                  >
                    <Icon icon={tool.readOnly ? ShieldCheck : Zap} size="sm" />
                    {tool.readOnly ? 'Read' : 'Write'}
                  </span>
                </div>
                <p className="off-pers-skrow-desc">{tool.description}</p>
                <code className="off-pers-tool-code">{tool.toolName}</code>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
