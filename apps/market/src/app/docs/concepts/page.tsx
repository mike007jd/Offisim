import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Core Concepts' };

interface Concept {
  title: string;
  anchor: string;
  description: string;
}

const CONCEPTS: Concept[] = [
  {
    title: 'Company',
    anchor: 'company',
    description:
      'A company is your AI workspace. It contains employees, projects, settings, and an office layout. Each company runs as an isolated runtime instance with its own state, database, and model configuration. You can create multiple companies for different teams or workflows.',
  },
  {
    title: 'Employee',
    anchor: 'employee',
    description:
      'An employee is an AI agent with a defined role, skill set, SOP (standard operating procedure), and model assignment. Employees live in zones, receive tasks from the Manager, execute work according to their SOPs, and produce artifacts. You can hire employees from templates, the marketplace, or build your own.',
  },
  {
    title: 'Project',
    anchor: 'project',
    description:
      'A project is a task unit that flows through the company. It has phases, steps, and DAG-based dependencies. The Boss creates projects from your natural language requests, the Manager breaks them into steps, the PM tracks progress, and employees execute the work.',
  },
  {
    title: 'Boss / Manager / PM / HR',
    anchor: 'system-agents',
    description:
      'These are built-in system agents that form the management layer. The Boss interprets your intent and creates projects. The Manager decomposes projects into steps and assigns employees. The PM monitors progress and handles reporting. HR manages hiring, onboarding, and role changes.',
  },
  {
    title: 'Zone',
    anchor: 'zone',
    description:
      'Zones are department areas in the office layout. The six standard zones are DEV (development), ART (creative/design), PROD (production/ops), REST (break area), MTG (meeting rooms), and LIB (library/research). Employees are assigned to zones based on their roles, and zones determine spatial layout in the office view.',
  },
  {
    title: 'Asset Package',
    anchor: 'package',
    description:
      'An asset package is an installable unit from the marketplace. Packages are declarative and auditable \u2014 they contain a manifest and assets but no executable hooks or embedded secrets. Package types include employees, skills, SOPs, company templates, office layouts, and bundles.',
  },
  {
    title: 'SOP (Standard Operating Procedure)',
    anchor: 'sop',
    description:
      'An SOP is a workflow template that defines how an employee should approach a type of task. SOPs are structured as directed acyclic graphs (DAGs) of steps, with conditions, branching, and artifact outputs. They make employee behavior predictable, auditable, and shareable.',
  },
  {
    title: 'Skill',
    anchor: 'skill',
    description:
      'A skill is a capability that an employee can use during task execution. Skills can wrap MCP tools, define specialized prompts, or provide domain-specific knowledge. Employees can have multiple skills, and skills can be shared across employees via packages.',
  },
];

export default function ConceptsPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight">Core Concepts</h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed max-w-lg">
        The fundamental building blocks of the Offisim runtime. Understanding these concepts will
        help you build effective AI companies.
      </p>

      <div className="mt-10 space-y-0">
        {CONCEPTS.map((concept, i) => (
          <section
            key={concept.anchor}
            id={concept.anchor}
            className={`py-8 ${i > 0 ? 'border-t border-[var(--border)]' : ''}`}
          >
            <h2 className="font-display text-xl font-semibold">{concept.title}</h2>
            <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
              {concept.description}
            </p>
          </section>
        ))}
      </div>
    </>
  );
}
