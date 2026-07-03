import assert from 'node:assert/strict';
import {
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { createMcpBridgeExtensionFactory } from './pi-mcp-bridge-extension.mjs';

const cwd = process.cwd();
const agentDir = `${cwd}/.tmp/pi-sdk-harness-agent`;
const settingsManager = SettingsManager.create(cwd, agentDir);
const emitted = [];
const mcpCalls = [];
let approvalRequest = null;

const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager,
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  extensionFactories: [
    createMcpBridgeExtensionFactory({
      mcpTools: [
        {
          name: 'list_apps',
          server: 'cua-driver',
          category: 'computer-use',
          description: 'List running apps.',
          annotations: { readOnlyHint: true },
        },
      ],
      requestMcpResult: async (server, tool, args) => {
        mcpCalls.push({ server, tool, args });
        return {
          id: 'mcp-1',
          ok: true,
          content: [{ type: 'text', text: '17' }],
          isError: false,
        };
      },
      confirmMcpToolCall: async (input) => {
        approvalRequest = input;
        return true;
      },
      emit: (line) => emitted.push(line),
      threadId: 'thread-sdk',
      rootRunId: 'run-sdk',
      employeeId: 'emp-sdk',
    }),
  ],
});

await resourceLoader.reload();

const { session } = await createAgentSession({
  cwd,
  agentDir,
  settingsManager,
  resourceLoader,
  sessionManager: SessionManager.inMemory(cwd),
  tools: ['mcp_search_tools', 'mcp_describe_tool', 'mcp_call'],
});

try {
  await session.bindExtensions({
    mode: 'rpc',
    uiContext: {
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      notify: () => {},
      onTerminalInput: () => () => {},
      setStatus: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      custom: async () => undefined,
      pasteToEditor: () => {},
      setEditorText: () => {},
      getEditorText: () => '',
      editor: async () => undefined,
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() {
        return undefined;
      },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: 'not available' }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    },
  });

  const tool = session.state.tools.find((entry) => entry.name === 'mcp_call');
  assert(tool, 'mcp_call must be active on the Pi Agent session');

  const result = await tool.execute('call-sdk', {
    name: 'list_apps',
    input: {},
  });

  assert.equal(result.content[0].text, '17');
  assert.deepEqual(mcpCalls, [{ server: 'cua-driver', tool: 'list_apps', args: {} }]);
  assert.equal(approvalRequest.server, 'cua-driver');
  assert.equal(approvalRequest.toolName, 'list_apps');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].runType, 'mcp.tool.called');
  assert.equal(emitted[0].payload.approvalStatus, 'human_approved');

  console.log('PASS harness:mcp-bridge-sdk');
} finally {
  session.dispose();
}
