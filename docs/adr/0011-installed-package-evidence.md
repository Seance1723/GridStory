# ADR 0011: Installed package evidence from reviewed tarballs

- Status: Accepted
- Date: 2026-08-21
- Task: M5-009

## Context

GridStory's release-evidence path deterministically packs five private `0.0.0` workspaces and restricts their inventories, but M5-008 found that the archives have no package-specific README and their packed manifests have no SPDX license field. Pnpm already places the canonical workspace-root Apache-2.0 `LICENSE` text in each tarball, so copying that file into five source directories would add drift without changing the artifact. More importantly, packing alone does not prove that workspace dependencies were rewritten, installed declarations are complete, or a consumer can resolve every declared export without monorepo links.

M5-009 is an archive-readiness task, not permission to publish. The package names, private flag, version, registry visibility, framework coverage, hosted provenance, and historical M5-008 no-go decision remain unchanged.

## Prior-art comparison

| Approach | Evidence and fit | Decision |
|---|---|---|
| Do nothing; keep permissive inventory validation | Lowest cost, but preserves BUG-0243 and permits archives with absent consumer/legal context. | Rejected. |
| Copy the complete repository README and LICENSE into every package source | Makes metadata visible in each directory, but the repository README is not package-specific and five license copies can drift; pnpm already packs the canonical root license. | Rejected. |
| Add package-specific READMEs and SPDX fields, then require README/LICENSE/license contents in the actual tarball | Keeps guidance close to each package while validating the exact distributed artifact and canonical license bytes. | Selected. |
| Mutate package metadata or files in prepack/postpack hooks | Avoids source files but creates hidden, stateful pack behavior and cleanup risk; a pack failure could leave source trees modified. | Rejected. |
| Add a permanent example application for release installation | Provides a visible fixture, but duplicates the existing Vite examples and may silently rejoin the workspace. | Rejected for this narrow contract. |
| Install all tarballs into an OS temporary non-workspace project, offline, then execute and type-check every export | Proves dependency rewriting, installability, runtime entry points, stylesheet resolution, and declarations against built archives without adding a new product example. | Selected. |

## Necessity gate

1. **Traceable:** BUG-0243 and readiness criterion `RC-003` explicitly require publication metadata and installed-consumer evidence for all five archives.
2. **Not already solved:** archive allow-listing proves only that unexpected files are absent; current repository examples consume workspace links and cannot detect a broken packed manifest or missing installed declaration dependency.
3. **Minimal form:** five concise package READMEs, five SPDX fields, stricter checks in the existing release script, and one disposable consumer. Do not add a registry, release manager, new example app, pack plugin, or publication workflow.
4. **Dependency justified:** no dependency is added. Node, tar, the pinned pnpm CLI, the existing TypeScript compiler, and already installed dependency-store content provide the checks.
5. **Rule of three:** retain the explicit fixed list of five reviewed packages and their declared exports; introduce no generic package-release framework or configurable policy language.
6. **Reversible:** all source and verification changes revert in one commit; temporary consumer files are removed after the check, and no external release state changes.

## Decision

Each package source owns a concise `README.md` naming its purpose, supported installation boundary, and public exports. Each package manifest declares `license: Apache-2.0`. The release validator continues to allow only the reviewed distributable paths, but now requires exactly one `package.json`, `README.md`, and `LICENSE`, rejects duplicate normalized paths, validates package identity/version/license, ensures no packed dependency retains `workspace:`, requires useful package-specific README text, and verifies that the archived license bytes match the repository's canonical `LICENSE`.

After all five tarballs pass inventory validation, release preparation creates a uniquely named directory under the operating system's temporary root. It writes a private consumer manifest that references all GridStory dependencies by tarball, adds only the declared React peer and ambient Node/React type environment, and runs pnpm with `--offline` and lifecycle scripts disabled. A generated ESM smoke imports every JavaScript export and resolves the example stylesheet; a strict NodeNext TypeScript input imports every typed entry. The directory must be outside the repository and is removed in a `finally` block.

This evidence means the reviewed local tarballs are complete enough to install and exercise. It does not select a version, remove publication safeguards, prove a registry install, authorize public distribution, implement missing framework adapters, or satisfy hosted provenance and deployment criteria.

## Sources

- <https://docs.npmjs.com/cli/v11/configuring-npm/package-json/>
- <https://docs.npmjs.com/about-package-readme-files>
- <https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/>
- <https://pnpm.io/cli/pack>

## Consequences

- A successful archive check now proves required metadata exists in the distributed bytes rather than merely being allowed by an inventory.
- Package guidance stays specific and source-reviewable, while canonical license text remains single-source and byte-checked in every tarball.
- The temporary consumer catches unresolved workspace specifications, missing runtime dependencies, invalid exports, and incomplete declaration dependencies before publication.
- Offline installation is deliberately stricter than a normal registry-backed consumer test; a future authorized publication still needs registry identity/version, trusted publishing, hosted attestation, and clean-machine network installation evidence.
