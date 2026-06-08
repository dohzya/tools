# Documentation Review

## Review Workflow

1. Inventory the documentation scope under review.
2. Extract metadata: category, themes, source reference, verification date, language, and directives.
3. Compare documented behavior with source material.
4. Check language, naming, category placement, links, examples, and completeness.
5. Write a durable review file in `docs/review/` using `YYYY-MM-DD-HHmm-slug.md`.

Do not mix review findings into maintenance edits. A review identifies issues and recommendations. Maintenance applies the accepted changes.

## Review Report Content

A review file should include:

- date and source reference;
- scope reviewed;
- summary of findings;
- findings ordered by severity;
- evidence with file paths, source references, or excerpts;
- recommended fixes;
- residual risks or open questions;
- validation performed.

## Severity Guidance

- `high`: documented behavior contradicts source material, security/privacy information is wrong, or content is in the wrong category.
- `medium`: examples are outdated, important links are missing, directives are only partially applied, or a relevant edge case is omitted.
- `low`: style drift, minor terminology variation, weak discoverability, or optional completeness improvements.

## Review Checklist

For each reviewed document, check:

- language metadata;
- category and directory alignment;
- metadata freshness;
- links and source references;
- correctness against source material;
- completeness for critical workflows and options;
- consistency with neighboring documents;
- absence of sensitive data;
- whether findings are actionable enough to become maintenance tasks.
