const CATEGORY_ROOT_NAMES = {
  vehicleLabel: "Vehicle Labels",
  mmyYear: "MMY Year",
  mmyMake: "MMY Make",
  mmyModel: "MMY Model",
  area: "Area",
  manager: "Manager"
};

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

export class GroupMapper {
  constructor(groups = []) {
    this.groupById = new Map();
    this.childrenByParentId = new Map();
    this.rootIds = [];

    for (const group of groups) {
      if (!group || !group.id) {
        continue;
      }

      const normalized = {
        id: group.id,
        name: group.name || "",
        parentId: group.parentId || group?.parent?.id || null,
        raw: group
      };
      this.groupById.set(normalized.id, normalized);
    }

    for (const group of this.groupById.values()) {
      if (!group.parentId || !this.groupById.has(group.parentId)) {
        this.rootIds.push(group.id);
        continue;
      }

      if (!this.childrenByParentId.has(group.parentId)) {
        this.childrenByParentId.set(group.parentId, []);
      }
      this.childrenByParentId.get(group.parentId).push(group.id);
    }

    this.categoryRoots = this.#findCategoryRoots();
  }

  getGroupTree() {
    const buildNode = (groupId) => {
      const group = this.groupById.get(groupId);
      if (!group) {
        return null;
      }

      const childIds = this.childrenByParentId.get(groupId) || [];
      return {
        id: group.id,
        name: group.name,
        parentId: group.parentId,
        children: childIds.map((id) => buildNode(id)).filter(Boolean)
      };
    };

    return this.rootIds.map((id) => buildNode(id)).filter(Boolean);
  }

  mapDeviceGroups(device) {
    const warnings = [];
    const assignedGroupIds = Array.isArray(device?.groupIds) ? device.groupIds.filter(Boolean) : [];
    const assignedSet = new Set(assignedGroupIds);

    const normalized = {
      vehicleLabel: this.#resolveCategoryValue("vehicleLabel", assignedSet, warnings),
      mmyYear: this.#resolveCategoryValue("mmyYear", assignedSet, warnings),
      mmyMake: this.#resolveCategoryValue("mmyMake", assignedSet, warnings),
      mmyModel: this.#resolveCategoryValue("mmyModel", assignedSet, warnings),
      area: this.#resolveAreaValue(assignedSet, warnings),
      manager: this.#resolveCategoryValue("manager", assignedSet, warnings)
    };

    return { ...normalized, warnings };
  }

  getAreaAndManager(device) {
    const mapped = this.mapDeviceGroups(device);
    return {
      area: mapped.area || "",
      manager: mapped.manager || "",
      warnings: mapped.warnings
    };
  }

  #findCategoryRoots() {
    const byName = new Map();
    for (const group of this.groupById.values()) {
      byName.set(normalizeName(group.name), group.id);
    }

    const roots = {};
    for (const [key, expectedName] of Object.entries(CATEGORY_ROOT_NAMES)) {
      roots[key] = byName.get(normalizeName(expectedName)) || null;
    }
    return roots;
  }

  #resolveCategoryValue(categoryKey, assignedSet, warnings) {
    const rootId = this.categoryRoots[categoryKey];
    const label = CATEGORY_ROOT_NAMES[categoryKey];

    if (!rootId) {
      warnings.push(`Category root '${label}' not found in group hierarchy.`);
      return "";
    }

    const matches = this.#findAssignedDescendants(rootId, assignedSet, { excludeRoot: true });
    if (matches.length === 0) {
      warnings.push(`No '${label}' group assigned to this asset.`);
      return "";
    }

    if (matches.length > 1) {
      warnings.push(
        `Multiple '${label}' groups found (${matches.map((m) => m.name).join(", ")}). Using deepest match.`
      );
    }

    return matches[0].name || "";
  }

  #resolveAreaValue(assignedSet, warnings) {
    const rootId = this.categoryRoots.area;
    const label = CATEGORY_ROOT_NAMES.area;

    if (!rootId) {
      warnings.push(`Category root '${label}' not found in group hierarchy.`);
      return "";
    }

    const matches = this.#findAssignedDescendants(rootId, assignedSet, { excludeRoot: true });
    if (matches.length === 0) {
      warnings.push("No 'Area' group assigned to this asset.");
      return "";
    }

    const specificMatches = matches.filter((group) => {
      const path = this.#pathFromRoot(group.id, rootId);
      // Path includes root and current; depth >= 3 means below bucket level (Area -> bucket -> actual area)
      return path.length >= 3;
    });

    const effective = specificMatches.length > 0 ? specificMatches : matches;
    if (effective.length > 1) {
      warnings.push(
        `Multiple 'Area' groups found (${effective.map((m) => m.name).join(", ")}). Using deepest match.`
      );
    }

    return effective[0].name || "";
  }

  #findAssignedDescendants(rootId, assignedSet, options = {}) {
    const results = [];
    const stack = [{ id: rootId, depth: 0 }];

    while (stack.length > 0) {
      const current = stack.pop();
      const group = this.groupById.get(current.id);
      if (!group) {
        continue;
      }

      const isRoot = current.id === rootId;
      if (!(options.excludeRoot && isRoot) && assignedSet.has(current.id)) {
        results.push({
          id: group.id,
          name: group.name || "",
          depth: current.depth
        });
      }

      const childIds = this.childrenByParentId.get(current.id) || [];
      for (const childId of childIds) {
        stack.push({ id: childId, depth: current.depth + 1 });
      }
    }

    results.sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name));
    return results;
  }

  #pathFromRoot(groupId, rootId) {
    const path = [];
    const seen = new Set();
    let current = this.groupById.get(groupId) || null;

    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current.id);
      if (current.id === rootId) {
        return path;
      }
      current = current.parentId ? this.groupById.get(current.parentId) : null;
    }

    return [];
  }
}

/*
Unit-test-like sample data and expected behavior
------------------------------------------------

const groups = [
  { id: "company", name: "Company Group", parentId: null },
  { id: "vehicle-labels", name: "Vehicle Labels", parentId: "company" },
  { id: "label-truck-101", name: "Truck 101", parentId: "vehicle-labels" },
  { id: "mmy-year", name: "MMY Year", parentId: "company" },
  { id: "year-2021", name: "2021", parentId: "mmy-year" },
  { id: "mmy-make", name: "MMY Make", parentId: "company" },
  { id: "make-ford", name: "Ford", parentId: "mmy-make" },
  { id: "mmy-model", name: "MMY Model", parentId: "company" },
  { id: "model-f150", name: "F-150", parentId: "mmy-model" },
  { id: "area", name: "Area", parentId: "company" },
  { id: "bucket-1-40", name: "Groups 1 to 40", parentId: "area" },
  { id: "area-burnaby", name: "Burnaby North", parentId: "bucket-1-40" },
  { id: "manager", name: "Manager", parentId: "company" },
  { id: "manager-amy", name: "Amy Patel", parentId: "manager" }
];

const mapper = new GroupMapper(groups);
const device = {
  groupIds: ["label-truck-101", "year-2021", "make-ford", "model-f150", "area-burnaby", "manager-amy"]
};

const result = mapper.mapDeviceGroups(device);
// Expected:
// result.vehicleLabel === "Truck 101"
// result.mmyYear === "2021"
// result.mmyMake === "Ford"
// result.mmyModel === "F-150"
// result.area === "Burnaby North" (not "Groups 1 to 40")
// result.manager === "Amy Patel"
// result.warnings.length === 0

const missingArea = mapper.mapDeviceGroups({ groupIds: ["label-truck-101"] });
// Expected:
// missingArea.area === ""
// missingArea.warnings contains "No 'Area' group assigned to this asset."

const duplicateArea = mapper.mapDeviceGroups({
  groupIds: ["area-burnaby", "manager-amy", "label-truck-101", "year-2021", "make-ford", "model-f150", "bucket-1-40"]
});
// Expected:
// duplicateArea.area === "Burnaby North"
// duplicateArea.warnings includes multiple area warning if more than one matching area leaf exists
*/
