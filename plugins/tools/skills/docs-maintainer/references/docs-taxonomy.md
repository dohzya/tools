# Documentation Taxonomy

## Directory Recap

| Location            | Purpose                                                                                            | Audience                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `docs/functional/`  | User-facing behavior, domain concepts, business rules, workflows, and constraints                  | Product, business, support, new contributors |
| `docs/technical/`   | Architecture, implementation details, APIs, configuration, data model, and engineering constraints | Engineers and operators                      |
| `docs/operations/`  | Repeatable operational procedures, runbooks, deployment actions, and support actions               | Operators, support, on-call engineers        |
| `docs/exploration/` | Durable discovery notes, spikes, option analysis, and investigation paths before a final decision  | Project team and maintainers                 |
| `docs/postmortems/` | Dated incident or regression analyses                                                              | Project team and maintainers                 |
| `docs/refs/`        | Raw or lightly annotated reference material that must remain close to its source form              | Readers who need primary evidence            |
| `docs/review/`      | Durable reviews of documentation, branches, diffs, commits, or implementation choices              | Reviewers and maintainers                    |

## AGENTS.md Recap

When `AGENTS.md` needs a docs recap, keep it short and directory-level:

```markdown
## Documentation

- `docs/functional/`: user-facing behavior, domain concepts, business rules, workflows, and constraints.
- `docs/technical/`: architecture, implementation details, APIs, configuration, data model, and engineering constraints.
- `docs/operations/`: repeatable operational procedures, runbooks, deployment actions, and support actions.
- `docs/exploration/`: durable discovery notes, spikes, option analysis, and investigation paths before a final decision.
- `docs/postmortems/`: dated incident or regression analyses.
- `docs/refs/`: raw or lightly annotated reference material that must remain close to its source form.
- `docs/review/`: durable reviews of documentation, branches, diffs, commits, or implementation choices.
```

Adjust the snippet to the actual directories used by the project. Do not add directories that do not exist unless the documentation task creates them.

## Choosing The Right Location

Use `docs/functional/` for what the system does and why it matters:

- user types and capabilities;
- business rules and domain constraints;
- user workflows;
- user-visible limits and failure modes;
- acceptance scenarios and expected behavior.

Use `docs/technical/` for how the system works or how to change it:

- system architecture and module responsibilities;
- APIs, contracts, schemas, and state keys;
- configuration and environment variables;
- permissions, security, and compliance implementation;
- data storage, data access, observability, CI/CD, and infrastructure behavior.

Use `docs/operations/` for procedures that someone can execute:

- prerequisites;
- ordered steps;
- exact commands;
- expected output or verification signals;
- rollback or troubleshooting guidance.

Use `docs/exploration/` for discovery work that is durable but not yet a final reference, decision, or maintained behavior document:

- investigation paths and alternatives compared;
- spikes and prototypes;
- open questions and rejected options;
- evidence gathered before a decision;
- transition notes that may later be promoted into functional, technical, or operations docs.

Use `docs/postmortems/` for incidents and regressions:

- symptoms;
- impact;
- root cause;
- remediation;
- prevention;
- links or references to follow-up changes.

Use `docs/refs/` for primary material that should not be rewritten heavily. If a reference contains a durable decision, constraint, or behavior, create a separate synthesis in the appropriate functional, technical, or operations directory.

Use `docs/review/` for durable review artifacts. Review outputs must be written there, not left only in conversation.

## File Naming

- General Markdown files: `lowercase-kebab-case.md`.
- Files in `docs/exploration/`: `YYYY-MM-DD-HHmm-slug.md`.
- Files in `docs/postmortems/`: `YYYY-MM-DD-HHmm-slug.md`.
- Files in `docs/refs/`: `YYYY-MM-DD-HHmm-slug.md`.
- Files in `docs/review/`: `YYYY-MM-DD-HHmm-slug.md`.
- Diagrams and images should share the prefix of the document that uses them when possible.

Avoid vague names such as `notes.md`, `review.md`, `misc.md`, `new-doc.md`, or `todo.md`.

## Common Themes

- `architecture`: system overview, module responsibilities, flows.
- `agents`: agents, prompts, tools, orchestration.
- `api`: endpoints, request and response contracts.
- `auth`: authentication, authorization, permissions.
- `compliance`: privacy rules, masking, safe logging.
- `data-model`: entities, schemas, relationships.
- `environment`: environment variables, configuration, secrets handling.
- `operations`: deployment, support, exploitation procedures.
- `testing`: tests, non-regression, test data, and acceptance scenarios.
