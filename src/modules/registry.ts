import type { BaseModule } from "./base-module.js";

const modules: BaseModule[] = [];

export function registerModule(mod: BaseModule): void {
  modules.push(mod);
}

export function getModules(): BaseModule[] {
  return [...modules];
}

/** 必須依存の検証 + トポロジカルソート */
export function resolveOrder(selected: BaseModule[]): BaseModule[] {
  const idSet = new Set(selected.map((m) => m.id));

  // Hard dependency validation
  const missing: string[] = [];
  for (const mod of selected) {
    for (const depId of mod.dependencies) {
      if (!idSet.has(depId)) {
        missing.push(`「${mod.name}」は「${depId}」が必要です`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`依存関係エラー:\n${missing.join("\n")}`);
  }

  // Topological sort
  const sorted: BaseModule[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(mod: BaseModule): void {
    if (visited.has(mod.id)) return;
    if (visiting.has(mod.id)) {
      throw new Error(`循環依存が検出されました: ${mod.id}`);
    }
    visiting.add(mod.id);
    for (const depId of mod.dependencies) {
      const dep = selected.find((m) => m.id === depId);
      if (dep) visit(dep);
    }
    visiting.delete(mod.id);
    visited.add(mod.id);
    sorted.push(mod);
  }

  for (const mod of selected) visit(mod);
  return sorted;
}
