import { describe, expect, it } from 'vitest';
import { describeWorkingToolActivity } from '../../hooks/useSceneOrchestrator';

describe('describeWorkingToolActivity', () => {
  it('maps started tool categories to working-stage bubble text', () => {
    expect(
      describeWorkingToolActivity({
        toolName: 'search_code',
        serverName: 'github',
        status: 'started',
      }),
    ).toBe('Searching code...');
    expect(
      describeWorkingToolActivity({
        toolName: 'read_file',
        status: 'started',
      }),
    ).toBe('Reading files...');
    expect(
      describeWorkingToolActivity({
        toolName: 'apply_patch',
        status: 'started',
      }),
    ).toBe('Editing workspace...');
    expect(
      describeWorkingToolActivity({
        toolName: 'bash',
        status: 'started',
      }),
    ).toBe('Running shell task...');
  });

  it('maps completed and blocked tool activity to concise scene feedback', () => {
    expect(
      describeWorkingToolActivity({
        toolName: 'fetch_file',
        serverName: 'github',
        status: 'completed',
      }),
    ).toBe('Files reviewed');
    expect(
      describeWorkingToolActivity({
        toolName: 'search_code',
        serverName: 'github',
        status: 'denied',
        errorType: 'TOOL_PERMISSION_REQUIRED',
      }),
    ).toBe('Waiting on approval...');
    expect(
      describeWorkingToolActivity({
        toolName: 'bash',
        status: 'error',
      }),
    ).toBe('Tool step failed');
  });
});
