import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@aics/ui-core';
import { RD_COMPANY_ZONES, computeFloorPlan } from '@aics/renderer';
import { MessageSquare } from 'lucide-react';
import type { UseEmployeeEditorReturn } from '../../hooks/useEmployeeEditor';
import { TestChatTab } from './TestChatTab';
import { VersionHistoryTab } from './VersionHistoryTab';
import { AvatarCustomizer } from './AvatarCustomizer';
import { SkillBindingList } from './SkillBindingList';
import { ROLE_OPTIONS } from '../../lib/roles';

// Generate workstation options from the default floor plan
const _defaultPlan = computeFloorPlan(RD_COMPANY_ZONES, new Map());
const WORKSTATION_OPTIONS = Array.from(_defaultPlan.allWorkstations.entries()).map(([id], i) => ({
  value: id,
  label: `Workstation ${i + 1}`,
}));

interface EmployeeEditorDialogProps extends UseEmployeeEditorReturn {}

export function EmployeeEditorDialog({
  isOpen,
  employeeId,
  formData,
  isDirty,
  isSaving,
  isConfirmingDelete,
  updateField,
  save,
  requestDelete,
  cancelDelete,
  confirmDelete,
  close,
  sourceAssetId,
  sourcePackageId,
}: EmployeeEditorDialogProps) {
  const isEditMode = employeeId !== null;
  const title = isEditMode ? `Edit Employee: ${formData.name || 'Unnamed'}` : 'New Employee';
  const canSave = isDirty && formData.name.trim() !== '' && !isSaving;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-w-lg h-[560px] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="profile" className="mt-2 flex-1 flex flex-col min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="profile" className="flex-1">
              Profile
            </TabsTrigger>
            <TabsTrigger value="persona" className="flex-1">
              Persona
            </TabsTrigger>
            <TabsTrigger value="config" className="flex-1">
              Config
            </TabsTrigger>
            {isEditMode && (
              <TabsTrigger value="test" className="flex-1">
                <MessageSquare className="h-3.5 w-3.5 mr-1" />
                Test
              </TabsTrigger>
            )}
            {isEditMode && (
              <TabsTrigger value="history" className="flex-1">
                History
              </TabsTrigger>
            )}
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col gap-4 pt-2">
              <div>
                <label htmlFor="editor-name" className="text-sm text-slate-400 mb-1 block">
                  Name
                </label>
                <Input
                  id="editor-name"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Employee name"
                />
              </div>

              <div>
                <label htmlFor="editor-role" className="text-sm text-slate-400 mb-1 block">
                  Role
                </label>
                <Select
                  value={formData.role_slug}
                  onValueChange={(v) => updateField('role_slug', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label htmlFor="editor-enabled" className="text-sm text-slate-400 mb-1 block">
                  Status
                </label>
                <Button
                  id="editor-enabled"
                  type="button"
                  variant={formData.enabled ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => updateField('enabled', !formData.enabled)}
                >
                  {formData.enabled ? 'Enabled' : 'Disabled'}
                </Button>
              </div>

              {/* Workstation assignment (accessibility fallback for drag-drop) */}
              <div>
                <label htmlFor="editor-workstation" className="text-sm text-slate-400 mb-1 block">
                  Assign Workstation
                </label>
                <Select
                  value={formData.workstation_id ?? 'none'}
                  onValueChange={(v) => updateField('workstation_id', v === 'none' ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {WORKSTATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Avatar appearance — persisted to persona_json via formData.appearance */}
              <AvatarCustomizer
                config={formData.appearance}
                onChange={(cfg) => updateField('appearance', cfg)}
              />
            </div>
          </TabsContent>

          {/* Persona Tab */}
          <TabsContent value="persona" className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col gap-4 pt-2">
              <div>
                <label htmlFor="editor-expertise" className="text-sm text-slate-400 mb-1 block">
                  Expertise
                </label>
                <Textarea
                  id="editor-expertise"
                  value={formData.expertise}
                  onChange={(e) => updateField('expertise', e.target.value)}
                  placeholder="e.g. full-stack development, React, Node.js"
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="editor-style" className="text-sm text-slate-400 mb-1 block">
                  Working Style
                </label>
                <Textarea
                  id="editor-style"
                  value={formData.style}
                  onChange={(e) => updateField('style', e.target.value)}
                  placeholder="e.g. detail-oriented, collaborative"
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="editor-instructions" className="text-sm text-slate-400 mb-1 block">
                  Custom Instructions
                </label>
                <Textarea
                  id="editor-instructions"
                  value={formData.customInstructions}
                  onChange={(e) => updateField('customInstructions', e.target.value)}
                  placeholder="Additional instructions for this employee's behavior..."
                  rows={4}
                />
              </div>
            </div>
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="config" className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col gap-4 pt-2">
              <div>
                <label htmlFor="editor-model" className="text-sm text-slate-400 mb-1 block">
                  Model Preference
                </label>
                <Input
                  id="editor-model"
                  value={formData.modelPreference}
                  onChange={(e) => updateField('modelPreference', e.target.value)}
                  placeholder="e.g. gpt-4, claude-3-opus (leave empty for default)"
                />
              </div>

              <div>
                <label htmlFor="editor-temperature" className="text-sm text-slate-400 mb-1 block">
                  Temperature
                </label>
                <Input
                  id="editor-temperature"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={formData.temperature}
                  onChange={(e) =>
                    updateField('temperature', Number.parseFloat(e.target.value) || 0)
                  }
                />
              </div>

              <div>
                <label htmlFor="editor-max-tokens" className="text-sm text-slate-400 mb-1 block">
                  Max Tokens
                </label>
                <Input
                  id="editor-max-tokens"
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={formData.maxTokens}
                  onChange={(e) =>
                    updateField('maxTokens', Number.parseInt(e.target.value, 10) || 4096)
                  }
                />
              </div>

              {/* Skills */}
              {isEditMode && employeeId && (
                <div>
                  <label className="text-sm text-slate-400 mb-2 block">Skills</label>
                  <SkillBindingList
                    employeeId={employeeId}
                    sourcePackageId={sourcePackageId ?? null}
                  />
                </div>
              )}
            </div>
          </TabsContent>

          {/* Test Chat Tab (edit mode only) */}
          {isEditMode && employeeId && (
            <TabsContent value="test" className="flex-1 overflow-y-auto min-h-0">
              <TestChatTab formData={formData} employeeName={formData.name} />
            </TabsContent>
          )}

          {/* History Tab (edit mode only) */}
          {isEditMode && employeeId && (
            <TabsContent value="history" className="flex-1 overflow-y-auto min-h-0">
              <VersionHistoryTab
                employeeId={employeeId}
                forkOrigin={sourceAssetId ? {
                  sourceAssetId,
                  sourcePackageId: sourcePackageId ?? null,
                } : null}
              />
            </TabsContent>
          )}
        </Tabs>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-700 mt-2">
          <div>
            {isEditMode && !isConfirmingDelete && (
              <Button variant="destructive" size="sm" disabled={isSaving} onClick={requestDelete}>
                Delete
              </Button>
            )}
            {isEditMode && isConfirmingDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-destructive">Delete this employee?</span>
                <Button variant="destructive" size="sm" disabled={isSaving} onClick={confirmDelete}>
                  {isSaving ? 'Deleting...' : 'Confirm'}
                </Button>
                <Button variant="outline" size="sm" onClick={cancelDelete}>
                  No
                </Button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canSave} onClick={save}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
