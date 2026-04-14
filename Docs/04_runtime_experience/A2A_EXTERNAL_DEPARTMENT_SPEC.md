# Offisim A2A External Department Spec

**Status:** approved product/engineering direction  
**Audience:** Kiro / Claude Opus / implementation agents  
**Priority:** high  
**Scope:** product abstraction and runtime/UI wiring for A2A-backed external capability

---

## 1. Decision

A2A in Offisim should be productized as **External Departments**, not as generic external employees.

The new direction is:

- **internal work = employees inside the company**
- **external work = outsourced departments / partner units**

This matches Offisim's core metaphor:

- the product is a company simulation
- not a flat agent marketplace

---

## 2. Why this is the right abstraction

### 2.1 Company-world fit

Users already think in:

- departments
- teams
- vendors
- outside specialists

They do not naturally think:

- "let me add a random external employee avatar into the office"

### 2.2 Boundary clarity

Internal employees and external partners should not share the same assumptions.

Internal employees have:

- desks
- scene presence
- company memory/vault semantics
- relationships/personality/ambient life

External A2A partners should first have:

- endpoint
- capabilities
- contract boundary
- response/output policy

Not:

- a seat in the office
- the same local social simulation model

### 2.3 Better routing semantics

Managers and dispatchers more naturally say:

- outsource design
- send this to external research
- hand this to legal partner

than:

- assign this to an "external employee" who behaves like a staff member

---

## 3. Product goal

Offisim must support a company model where some work is performed by:

- internal departments/employees
- external A2A-connected departments

The user should understand:

1. what the external department is
2. what it is good at
3. when work is being outsourced to it
4. what it returned
5. how it differs from internal staff

---

## 4. Scope

### In scope

- product abstraction for external department
- domain shape for A2A-backed external units
- manager/dispatcher routing target model
- UI representation of external departments
- task handoff semantics
- result visibility semantics

### Out of scope

- fully solving every transport/auth edge case
- pretending external departments are seated 3D characters
- turning A2A into a general plugin marketplace
- replacing internal employees as the default work model

---

## 5. Core concept

### 5.1 Internal employee

Represents:

- a member of the company
- scene presence
- local vault / memory / soul / relationships
- ambient work behavior

### 5.2 External department

Represents:

- an outsourced capability provider
- one or more remote agents behind an A2A endpoint
- a unit the company can delegate work to

Examples:

- external design studio
- external legal department
- external market research partner
- external frontend implementation vendor

---

## 6. Product model

The product should distinguish at least:

- `local_employee`
- `external_department`

An external department should carry product-facing fields such as:

- `id`
- `name`
- `kind = external_department`
- `a2aUrl`
- `agentCard`
- `capabilities`
- `summary`
- `availability`
- `authState`
- `status`
- `branding/icon`

Optional future fields:

- SLA / response profile
- pricing/cost surface
- trust/risk score
- preferred task types

---

## 7. UX representation

### 7.1 Do not represent as seated office employee first

External departments should **not** initially appear as:

- a normal employee row with a fake desk identity
- a 3D office resident
- a member of the same in-office social simulation layer

That can be explored later for specific products, but must not be the default 1.0 path.

### 7.2 Recommended visible surfaces

External departments should appear as:

- department cards
- partner capability cards
- routing targets in task delegation UI
- result sources in chat/tasks/deliverables

### 7.3 Naming

The naming should sound organizational:

- `External Design`
- `Research Partner`
- `Legal Vendor`
- `A2A Partner Unit`

Not:

- `External Employee 01`
- `Remote Bot`

---

## 8. Routing model

### 8.1 Manager/boss mental model

When routing work, the system should be able to choose:

- internal employee(s)
- external department
- mixed handoff

Examples:

- internal PM defines spec -> external frontend department builds prototype
- internal designer drafts direction -> external research department validates

### 8.2 UI explanation

When a task is sent externally, the UI should say so explicitly:

- `Outsourced to External Design`
- `Delegated to Research Partner`

The user should never have to infer that an A2A endpoint was involved.

### 8.3 Result ownership

Returned outputs should preserve source identity:

- which external department handled it
- whether it was internal vs outsourced

This matters in:

- chat
- tasks
- deliverables
- activity log

---

## 9. Relationship to 3D / 2D scene

### 9.1 1.0 default

For 1.0, external departments should **not** require full scene embodiment.

They can be represented through:

- rail cards
- task lanes
- department chips
- handoff badges

### 9.2 Future expansion

If later desired, Offisim may give certain external departments richer embodiment, but only after:

- routing
- result attribution
- trust/auth semantics

are already solid.

Scene embodiment is garnish, not the foundation.

---

## 10. Auth and trust semantics

Because A2A crosses system boundaries, external departments must expose state that internal employees do not need.

At minimum:

- reachable / unreachable
- authenticated / unauthenticated
- healthy / degraded / error

This should surface calmly but clearly in the UI.

The user must be able to tell:

- whether a department exists
- whether it is available now
- whether it is safe/ready to receive work

---

## 11. Deliverable and result semantics

External departments must fit into Offisim's deliverable model.

Their outputs should be treated as:

- outsourced deliverables
- external work products
- partner-generated results

The system should not hide whether the artifact came from:

- internal staff
- external A2A partner

This distinction is important for trust, review, and company-world clarity.

---

## 12. Runtime expectations

At runtime, A2A external departments should support:

- discovery or registration
- capability display
- task dispatch
- result return
- failure visibility

But the product bar is not "transport exists."

The product bar is:

- users understand what this outside unit is
- users can delegate to it intentionally
- users can see what came back

---

## 13. Acceptance criteria

### Product acceptance

A user can:

1. See at least one external department in the UI
2. Understand it is external, not a local employee
3. See what capabilities it offers
4. Delegate a task to it
5. Recognize the result as coming from that external department

### Runtime acceptance

In live runtime:

1. External department is discoverable or configured
2. A2A call succeeds or fails visibly
3. Failure states are explicit and not confused with internal employee states

### Narrative acceptance

The company metaphor remains coherent:

- internal company staff stay internal
- outsourced work stays visibly outsourced

---

## 14. Non-goals

This spec does **not** require:

- scene avatars for external departments
- relationship simulation for external departments
- local vault/memory/soul files for external departments
- social/ambient office behaviors for A2A peers

Those would be future product layers, not the 1.0 abstraction.
