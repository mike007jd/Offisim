/** Pill toggle className — shared by workspace sidebar pivots and tab controls. */
export function pillClass(active: boolean): string {
  return `text-[10px] px-2 py-0.5 rounded-full transition-colors ${
    active ? 'bg-white/10 text-slate-200' : 'text-slate-500 hover:text-slate-300'
  }`;
}
