import "dotenv/config";
import express from "express";
import path from "path";
import { parseCSV, buildTOC, DocumentTree } from "./parser.js";
import { query } from "./rag.js";

const app = express();
app.use(express.json());

// ─── In-memory state (one doc at a time) ──────────────────────────────────────
let tree: DocumentTree | null = null;

// ─── POST /load ───────────────────────────────────────────────────────────────
// Load a CSV file and build the document tree.
//
// Body: { "filePath": "./my-docs.csv" }
//
app.post("/load", (req, res) => {
  const { filePath } = req.body as { filePath?: string };

  if (!filePath) {
    res.status(400).json({ error: "filePath is required" });
    return;
  }

  try {
    const resolved = path.resolve(filePath);
    tree = parseCSV(resolved);

    res.json({
      message: "Document loaded successfully",
      filePath: resolved,
      modules: tree.root.children.map((n) => n.label),
      totalNodes: tree.nodeMap.size,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── POST /query ──────────────────────────────────────────────────────────────
// Ask a question. Returns the answer + which nodes were used.
//
// Body: { "question": "What are the addon category properties?" }
// Optional: { "showSources": true }
//
app.post("/query", async (req, res) => {
  const { question, showSources = false } = req.body as {
    question?: string;
    showSources?: boolean;
  };

  if (!tree) {
    res
      .status(400)
      .json({ error: "No document loaded. Call POST /load first." });
    return;
  }

  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  try {
    const result = await query(tree, question);

    res.json({
      question,
      answer: result.answer,
      sources: {
        nodeIds: result.nodeIds,
        // Only include raw content if explicitly asked
        ...(showSources && { content: result.content }),
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── GET /tree ────────────────────────────────────────────────────────────────
// Inspect the currently loaded document's TOC tree.
//
app.get("/tree", (req, res) => {
  if (!tree) {
    res
      .status(400)
      .json({ error: "No document loaded. Call POST /load first." });
    return;
  }

  res.json({
    filePath: tree.filePath,
    toc: buildTOC(tree),
    totalNodes: tree.nodeMap.size,
  });
});

// ─── GET /status ──────────────────────────────────────────────────────────────
app.get("/status", (_req, res) => {
  if (!tree) {
    res.json({ loaded: false });
    return;
  }

  res.json({
    loaded: true,
    filePath: tree.filePath,
    modules: tree.root.children.map((n) => n.label),
    totalNodes: tree.nodeMap.size,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Vectorless RAG server running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /load    — load a CSV file`);
  console.log(`  POST /query   — ask a question`);
  console.log(`  GET  /tree    — inspect loaded document tree`);
  console.log(`  GET  /status  — check what's loaded\n`);
});
