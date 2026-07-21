import { Type } from 'typebox';

export const PROJECT_WORKSPACE_REQUIRED_TOOL = 'project_workspace_required';

const ProjectWorkspaceRequiredParams = Type.Object({});

export function normalizeExecuteWorkspace(payload) {
  const requirement = payload.workspaceRequirement;
  const availability = payload.workspaceAvailability;
  const reasonCode = payload.workspaceUnavailableReasonCode;
  if (requirement !== 'required' && requirement !== 'optional') {
    throw Object.assign(new Error('Pi work requests require a valid workspaceRequirement.'), {
      code: 'invalid-request',
    });
  }
  if (availability !== 'bound' && availability !== 'unavailable') {
    throw Object.assign(new Error('Pi work requests require a valid workspaceAvailability.'), {
      code: 'invalid-request',
    });
  }
  if (availability === 'bound') {
    if (reasonCode !== null) {
      throw Object.assign(
        new Error('A bound Pi work request cannot carry a workspace-unavailable reason.'),
        { code: 'invalid-request' },
      );
    }
    return { requirement, availability };
  }
  if (requirement !== 'optional') {
    throw Object.assign(
      new Error('A required Pi work request cannot run without a Project workspace.'),
      { code: 'project-workspace-required' },
    );
  }
  if (reasonCode !== 'none' && reasonCode !== 'ambiguous') {
    throw Object.assign(
      new Error('A workspace-unavailable Pi work request requires reason none or ambiguous.'),
      { code: 'invalid-request' },
    );
  }
  return { requirement, availability, reasonCode };
}

export function workspaceUnavailableSystemPrompt(reasonCode) {
  return [
    'This Offisim turn has no authorized Project workspace.',
    `Workspace recovery result: ${reasonCode}.`,
    'You have no file, shell, Git, delegation, mission, skill, or MCP access in this turn.',
    'Answer normally when the request can be handled from conversation context alone.',
    `When the request truly requires any unavailable capability, call ${PROJECT_WORKSPACE_REQUIRED_TOOL} exactly once, then clearly tell the user to restore or reselect the Project folder.`,
    'Never claim that you inspected, changed, ran, or verified project files in this state.',
  ].join('\n');
}

export function createProjectWorkspaceRequiredExtensionFactory(reasonCode) {
  return (pi) => {
    pi.registerTool({
      name: PROJECT_WORKSPACE_REQUIRED_TOOL,
      label: 'Project Workspace Required',
      description:
        'Use only when the user request truly requires project files, shell, Git, delegation, mission, skills, or MCP access and the Project workspace is unavailable.',
      parameters: ProjectWorkspaceRequiredParams,
      async execute() {
        return {
          content: [
            {
              type: 'text',
              text: `PROJECT_WORKSPACE_REQUIRED reason=${reasonCode}. No Project folder is authorized for this turn. Ask the user to restore or reselect the Project folder; do not claim project work was completed.`,
            },
          ],
        };
      },
    });
  };
}

export function assertWorkspaceToolAllowed(workspaceUnavailable, toolName) {
  if (workspaceUnavailable && toolName !== PROJECT_WORKSPACE_REQUIRED_TOOL) {
    throw Object.assign(
      new Error(`Workspace-unavailable work must not execute tool "${toolName}".`),
      { code: 'workspace-isolation' },
    );
  }
}
