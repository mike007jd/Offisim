export function formatInstallCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    employee: 'Employee',
    skill: 'Skill',
    sop: 'SOP',
    company_template: 'Template',
    office_layout: 'Layout',
    bundle: 'Bundle',
  };
  return labels[kind] ?? kind;
}

export function riskLabel(risk: string): string {
  const labels: Record<string, string> = {
    data_asset: 'Data Only',
    logic_asset: 'Logic',
    privileged_asset: 'Privileged',
  };
  return labels[risk] ?? risk;
}
