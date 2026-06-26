import { normalizeAppearance } from '@/data/adapters.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import type { EmployeeAppearance } from '@/lib/avatar.js';
import { listTemplates } from '@offisim/core/browser';
import {
  SYSTEM_ZONE_TEMPLATES,
  WIZARD_PREVIEW_COMPANY_ID,
  type ZoneArchetype,
  extractZoneSlug,
  resolveHomeZone,
  templateToZone,
} from '@offisim/shared-types';
import {
  Brain,
  Briefcase,
  FlaskConical,
  type LucideIcon,
  PenTool,
  Rocket,
  Wrench,
} from 'lucide-react';

/**
 * Renderer view-model for the company-creation wizard, derived entirely from the
 * canonical `@offisim/core` template definitions. There is no separate renderer
 * roster / preview-zone / employee-bio source anymore — this module maps the
 * frozen core contract into the shapes the wizard UI renders, and appends the
 * renderer-only "Create your own" entry.
 */

interface WizardZone {
  slug: string;
  label: string;
  archetype: ZoneArchetype;
  sortOrder: number;
}

export interface WizardEmployee {
  key: string;
  name: string;
  roleSlug: string;
  displayTitle: string;
  appearance: EmployeeAppearance | undefined;
  capabilities: string[];
  expertise: string;
  workingStyle: string;
  /** Slug of the zone this employee starts in, or null when unresolved. */
  homeZoneSlug: string | null;
}

export interface WizardTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  accentHex: string;
  tagline: string;
  bestFor: string[];
  capabilities: string[];
  isCustom?: boolean;
  employees: WizardEmployee[];
  zones: WizardZone[];
}

/** Lucide icon-name (from `presentation.icon`) → component. Unknown names fall
 *  back to Wrench so a new template never renders a blank icon slot. */
const ICON_BY_NAME: Record<string, LucideIcon> = {
  FlaskConical,
  PenTool,
  Rocket,
  Briefcase,
  Brain,
  Wrench,
};

function iconFor(name: string): LucideIcon {
  return ICON_BY_NAME[name] ?? Wrench;
}

/** The renderer-only "Create your own" template — opens the Studio editor
 *  instead of materializing a roster. Presentation moved here from the legacy
 *  wizard-data TEMPLATE_META entry. */
export const CREATE_YOUR_OWN_TEMPLATE: WizardTemplate = {
  id: 'create-your-own',
  name: 'Create Your Own',
  description: 'Design your office from scratch in the 3D Studio editor',
  icon: Wrench,
  accentHex: UI_DATA_COLORS.emerald,
  tagline: 'Design your office from scratch in the 3D Studio editor',
  bestFor: ['Custom layout', 'Full creative control'],
  capabilities: ['3D Studio Editor', 'Custom plot size', 'Free placement'],
  isCustom: true,
  employees: [],
  zones: [],
};

/** Map a canonical template definition → the wizard view model. */
function toWizardTemplate(def: ReturnType<typeof listTemplates>[number]): WizardTemplate {
  // Real preview zones: the template's custom zones, or the 7 system zones when
  // it materializes onto SYSTEM_ZONE_TEMPLATES. Sorted by sortOrder so the floor
  // plan reads in the same order it lays out in 3D.
  const zoneTemplates = [...(def.zones ?? SYSTEM_ZONE_TEMPLATES)].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const zones: WizardZone[] = zoneTemplates.map((z) => ({
    slug: z.slug,
    label: z.label,
    archetype: z.archetype,
    sortOrder: z.sortOrder,
  }));

  // Hydrated Zone[] for role→zone resolution (same path the runtime uses).
  const resolverZones = zoneTemplates.map((z) => templateToZone(z, WIZARD_PREVIEW_COMPANY_ID));

  const employees: WizardEmployee[] = def.employees.map((emp) => {
    // Same resolver as runtime materialization, so the preview seat placement
    // can never drift from where the employee actually spawns.
    const homeZone = resolveHomeZone(
      { role: emp.roleSlug, homeZoneSlug: emp.homeZoneSlug },
      resolverZones,
    );
    const homeZoneSlug = homeZone ? extractZoneSlug(homeZone.zoneId) : null;
    return {
      key: emp.key,
      name: emp.name,
      roleSlug: emp.roleSlug,
      displayTitle: emp.displayTitle,
      appearance: normalizeAppearance(emp.persona.appearance),
      capabilities: [...emp.capabilities],
      expertise: emp.persona.profile.expertise,
      workingStyle: emp.persona.profile.workingStyle,
      homeZoneSlug,
    };
  });

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    icon: iconFor(def.presentation.icon),
    accentHex: def.presentation.accent,
    tagline: def.presentation.tagline,
    bestFor: [...def.presentation.bestFor],
    capabilities: [...def.presentation.capabilities],
    employees,
    zones,
  };
}

/** Build the wizard view model from the canonical core templates. Returns only
 *  the real built-in templates; the wizard appends the renderer-only
 *  `CREATE_YOUR_OWN_TEMPLATE` entry itself. */
export function buildWizardTemplates(): WizardTemplate[] {
  return listTemplates().map(toWizardTemplate);
}
