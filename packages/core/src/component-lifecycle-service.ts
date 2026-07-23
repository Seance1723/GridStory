import {
  canonicalStringify,
  componentManifestSchema,
  sha256,
  type ComponentMigration,
  type ComponentNode,
  type ContentEntry,
  type ContentPerspective,
  type ContentScope,
  type ResolvedComponentManifest,
} from '@gridstory/schema';
import { GridStoryError, NotFoundError } from './errors.js';
import type { Actor } from './types.js';
import type { ContentService } from './content-service.js';

export interface ComponentUsageLocation {
  entryId: string;
  contentType: string;
  perspective: ContentPerspective;
  revisionId: string;
  field: string;
  nodeId: string;
  path: string;
  version: number;
}

export interface ComponentUsageReport {
  componentId: string;
  currentVersion: number;
  totalInstances: number;
  entries: number;
  byPerspective: Record<ContentPerspective, number>;
  byVersion: Record<string, number>;
  locations: ComponentUsageLocation[];
}

export interface ComponentMigrationPlan {
  id: string;
  component: ResolvedComponentManifest;
  usage: ComponentUsageReport;
  outdatedInstances: number;
  unmigratableVersions: number[];
  ready: boolean;
}

export interface ComponentVisualRegressionPlan {
  id: string;
  componentId: string;
  version: number;
  scenarios: ResolvedComponentManifest['visualRegression']['scenarios'];
  usageHooks: ComponentUsageLocation[];
  selector: string;
}

function rootsForEntry(
  entry: ContentEntry,
  schemas: ReturnType<ContentService['getSchemas']>,
): Array<{ field: string; nodes: ComponentNode[] }> {
  const schema = schemas.find((candidate) => candidate.id === entry.contentType);
  if (!schema) return [];
  return schema.fields.flatMap((field) => {
    if (field.type !== 'component-tree') return [];
    const value = entry.data[field.name];
    return Array.isArray(value) ? [{ field: field.name, nodes: value as ComponentNode[] }] : [];
  });
}

function visitNodes(
  nodes: ComponentNode[],
  path: string,
  visit: (node: ComponentNode, path: string) => void,
): void {
  nodes.forEach((node, index) => {
    const nodePath = `${path}[${index}]`;
    visit(node, nodePath);
    for (const [slot, children] of Object.entries(node.slots ?? {})) {
      visitNodes(children, `${nodePath}.slots.${slot}`, visit);
    }
  });
}

function migrationPath(
  manifest: ResolvedComponentManifest,
  fromVersion: number,
): ComponentMigration[] | null {
  if (fromVersion === manifest.version) return [];
  if (fromVersion > manifest.version) return null;
  const bySource = new Map(
    manifest.migrations.map((migration) => [migration.fromVersion, migration]),
  );
  const path: ComponentMigration[] = [];
  const visited = new Set<number>();
  let version = fromVersion;
  while (version !== manifest.version) {
    if (visited.has(version)) return null;
    visited.add(version);
    const migration = bySource.get(version);
    if (!migration) return null;
    path.push(migration);
    version = migration.toVersion;
  }
  return path;
}

function migrateNode(node: ComponentNode, manifest: ResolvedComponentManifest): boolean {
  let changed = false;
  if (node.component === manifest.id && node.version !== manifest.version) {
    const path = migrationPath(manifest, node.version);
    if (!path) {
      throw new GridStoryError(
        `Component ${manifest.id} version ${node.version} has no migration path to version ${manifest.version}.`,
        'component_migration_path_missing',
        422,
        { componentId: manifest.id, fromVersion: node.version, toVersion: manifest.version },
      );
    }
    for (const migration of path) {
      for (const operation of migration.operations) {
        if (operation.kind === 'rename-prop') {
          if (
            Object.hasOwn(node.props, operation.from) &&
            !Object.hasOwn(node.props, operation.to)
          ) {
            node.props[operation.to] = node.props[operation.from];
          }
          delete node.props[operation.from];
        } else if (operation.kind === 'set-default') {
          if (!Object.hasOwn(node.props, operation.name)) {
            node.props[operation.name] = structuredClone(operation.value);
          }
        } else {
          delete node.props[operation.name];
        }
      }
      node.version = migration.toVersion;
    }
    changed = true;
  }
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) changed = migrateNode(child, manifest) || changed;
  }
  return changed;
}

export class ComponentLifecycleService {
  readonly #content: ContentService;

  constructor({ contentService }: { contentService: ContentService }) {
    this.#content = contentService;
  }

  #manifest(componentId: string): ResolvedComponentManifest {
    const manifest = this.#content
      .getComponentManifests()
      .find((candidate) => candidate.id === componentId);
    if (!manifest) throw new NotFoundError(`Component ${componentId} is not registered.`);
    return componentManifestSchema.parse(manifest);
  }

  catalog(): ResolvedComponentManifest[] {
    return this.#content
      .getComponentManifests()
      .map((manifest) => componentManifestSchema.parse(manifest));
  }

  async usage(scope: ContentScope, componentId: string): Promise<ComponentUsageReport> {
    const manifest = this.#manifest(componentId);
    const locations: ComponentUsageLocation[] = [];
    for (const selectedPerspective of ['draft', 'published'] as const) {
      const entries = await this.#content.list({ scope, perspective: selectedPerspective });
      for (const entry of entries) {
        for (const root of rootsForEntry(entry, this.#content.getSchemas())) {
          visitNodes(root.nodes, root.field, (node, path) => {
            if (node.component !== componentId) return;
            locations.push({
              entryId: entry.id,
              contentType: entry.contentType,
              perspective: selectedPerspective,
              revisionId:
                selectedPerspective === 'published'
                  ? (entry.publishedRevisionId ?? entry.draftRevisionId)
                  : entry.draftRevisionId,
              field: root.field,
              nodeId: node.id,
              path,
              version: node.version,
            });
          });
        }
      }
    }
    return {
      componentId,
      currentVersion: manifest.version,
      totalInstances: locations.length,
      entries: new Set(locations.map((location) => location.entryId)).size,
      byPerspective: {
        draft: locations.filter((location) => location.perspective === 'draft').length,
        published: locations.filter((location) => location.perspective === 'published').length,
      },
      byVersion: Object.fromEntries(
        [...new Set(locations.map((location) => location.version))]
          .sort((left, right) => left - right)
          .map((version) => [
            String(version),
            locations.filter((location) => location.version === version).length,
          ]),
      ),
      locations,
    };
  }

  async planMigration(scope: ContentScope, componentId: string): Promise<ComponentMigrationPlan> {
    const component = this.#manifest(componentId);
    const usage = await this.usage(scope, componentId);
    const outdated = usage.locations.filter((location) => location.version !== component.version);
    const unmigratableVersions = [
      ...new Set(
        outdated
          .filter((location) => !migrationPath(component, location.version))
          .map((location) => location.version),
      ),
    ].sort((left, right) => left - right);
    const identity = { scope, componentId, version: component.version, locations: outdated };
    return {
      id: `component_migration_${sha256(canonicalStringify(identity)).slice(0, 20)}`,
      component,
      usage,
      outdatedInstances: outdated.length,
      unmigratableVersions,
      ready: unmigratableVersions.length === 0,
    };
  }

  async migrateEntry(input: {
    scope: ContentScope;
    entryId: string;
    componentId: string;
    expectedRevisionId: string;
    actor: Actor;
  }): Promise<{ entry: ContentEntry; migratedInstances: number; fromVersions: number[] }> {
    const manifest = this.#manifest(input.componentId);
    const current = await this.#content.get({
      scope: input.scope,
      id: input.entryId,
      perspective: 'draft',
    });
    const data = structuredClone(current.data);
    let migratedInstances = 0;
    const fromVersions = new Set<number>();
    for (const root of rootsForEntry({ ...current, data }, this.#content.getSchemas())) {
      visitNodes(root.nodes, root.field, (node) => {
        if (node.component === manifest.id && node.version !== manifest.version) {
          fromVersions.add(node.version);
          migratedInstances += 1;
        }
      });
      for (const node of root.nodes) migrateNode(node, manifest);
    }
    if (migratedInstances === 0) {
      throw new GridStoryError(
        `Entry ${input.entryId} does not require a ${input.componentId} migration.`,
        'component_migration_not_required',
        409,
      );
    }
    const entry = await this.#content.updateDraft({
      scope: input.scope,
      id: input.entryId,
      expectedRevisionId: input.expectedRevisionId,
      data,
      actor: input.actor,
    });
    return { entry, migratedInstances, fromVersions: [...fromVersions].sort() };
  }

  async visualRegression(
    scope: ContentScope,
    componentId: string,
  ): Promise<ComponentVisualRegressionPlan> {
    const component = this.#manifest(componentId);
    const usage = await this.usage(scope, componentId);
    const identity = {
      scope,
      componentId,
      version: component.version,
      scenarios: component.visualRegression.scenarios,
      usage: usage.locations,
    };
    return {
      id: `visual_regression_${sha256(canonicalStringify(identity)).slice(0, 20)}`,
      componentId,
      version: component.version,
      scenarios: component.visualRegression.scenarios,
      usageHooks: usage.locations,
      selector: `[data-gridstory-component="${componentId}"][data-gridstory-version="${component.version}"]`,
    };
  }
}
