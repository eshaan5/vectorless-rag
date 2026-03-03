import fs from "fs";
import Papa from "papaparse";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocNode {
  id: string;
  label: string;
  level: "module" | "section" | "topic";
  description: string;
  children: DocNode[];
}

export interface DocumentTree {
  filePath: string;
  root: DocNode;
  nodeMap: Map<string, DocNode>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\n/g, " ") // topic names can have newlines e.g. "Category\n(Baseline)"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function cleanText(text: string): string {
  return text.replace(/\r/g, "").trim();
}

// ─── Parser ───────────────────────────────────────────────────────────────────
//
// Your CSV columns:
//   Topic       — feature name (may have newlines e.g. "Category\n(Baseline)")
//   Level       — section inside the app e.g. "Brand", "Billing", "Settings"
//   Description — full feature description
//   Module      — top-level app module: Admin | Stock | Report | Integrations
//
// Tree: Module → Level → Topic

export function parseCSV(filePath: string): DocumentTree {
  const raw = fs.readFileSync(filePath, "utf-8");

  const result = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const rows = result.data;

  if (rows.length === 0) {
    throw new Error("CSV file is empty or has no data rows");
  }

  const headers = Object.keys(rows[0]);
  for (const col of ["Topic", "Level", "Description", "Module"]) {
    if (!headers.includes(col)) {
      throw new Error(
        `CSV missing required column: "${col}". Found: ${headers.join(", ")}`
      );
    }
  }

  const nodeMap = new Map<string, DocNode>();
  const root: DocNode = {
    id: "root",
    label: "Root",
    level: "module",
    description: "",
    children: [],
  };

  for (const row of rows) {
    const moduleName = cleanText(row["Module"] ?? "");
    const sectionName = cleanText(row["Level"] ?? "");
    const topicRaw = cleanText(row["Topic"] ?? "");
    const topicName = topicRaw.replace(/\n/g, " "); // flatten newlines in topic label
    const description = cleanText(row["Description"] ?? "");

    if (!moduleName || !sectionName || !topicName) continue;

    // ── Module ───────────────────────────────────────────────────────────────
    const moduleId = slugify(moduleName);
    if (!nodeMap.has(moduleId)) {
      const node: DocNode = {
        id: moduleId,
        label: moduleName,
        level: "module",
        description: "",
        children: [],
      };
      nodeMap.set(moduleId, node);
      root.children.push(node);
    }
    const moduleNode = nodeMap.get(moduleId)!;

    // ── Section (the "Level" column is the section/category) ─────────────────
    const sectionId = `${moduleId}.${slugify(sectionName)}`;
    if (!nodeMap.has(sectionId)) {
      const node: DocNode = {
        id: sectionId,
        label: sectionName,
        level: "section",
        description: "",
        children: [],
      };
      nodeMap.set(sectionId, node);
      moduleNode.children.push(node);
    }
    const sectionNode = nodeMap.get(sectionId)!;

    // ── Topic (leaf) ──────────────────────────────────────────────────────────
    const topicId = `${sectionId}.${slugify(topicRaw)}`;
    if (!nodeMap.has(topicId)) {
      const node: DocNode = {
        id: topicId,
        label: topicName,
        level: "topic",
        description,
        children: [],
      };
      nodeMap.set(topicId, node);
      sectionNode.children.push(node);
    }
  }

  return { filePath, root, nodeMap };
}

// ─── TOC Builder — this is what gets sent to Claude in RAG Step 1 ─────────────

export function buildTOC(tree: DocumentTree): string {
  const lines: string[] = [];

  function walk(node: DocNode, depth: number) {
    if (node.id === "root") {
      node.children.forEach((c) => walk(c, 0));
      return;
    }
    const indent = "  ".repeat(depth);
    lines.push(`${indent}[${node.id}] ${node.label}`);
    node.children.forEach((c) => walk(c, depth + 1));
  }

  walk(tree.root, 0);
  return lines.join("\n");
}

// ─── Node Content Fetcher — full text of picked nodes, sent in RAG Step 2 ─────

export function fetchNodeContent(
  tree: DocumentTree,
  nodeIds: string[]
): string {
  return nodeIds
    .map((id) => {
      const node = tree.nodeMap.get(id);
      if (!node) return `[Node "${id}" not found]`;

      const lines: string[] = [`## ${node.label}`];
      if (node.description) lines.push(node.description);

      // If a module/section was picked (not a leaf), include all children too
      function collectChildren(n: DocNode) {
        for (const child of n.children) {
          if (child.description)
            lines.push(`\n### ${child.label}\n${child.description}`);
          collectChildren(child);
        }
      }
      if (node.children.length > 0) collectChildren(node);

      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}