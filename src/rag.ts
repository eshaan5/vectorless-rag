import { GoogleGenerativeAI } from "@google/generative-ai";
import { DocumentTree, buildTOC, fetchNodeContent } from "./parser.js";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genai.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

// ─── Helper ───────────────────────────────────────────────────────────────────

async function generateGemini(prompt: string): Promise<string> {
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generate(prompt: string): Promise<string> {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
  });
  return response.choices[0].message.content ?? "";
}

// ─── Step 1: TOC Scan ─────────────────────────────────────────────────────────
// Gemini reads the table of contents and picks which node IDs to retrieve.
// No vectors. No similarity scores. Just reasoning.

async function scanTOC(
  tree: DocumentTree,
  question: string
): Promise<string[]> {
  const toc = buildTOC(tree);

  const prompt = `You are a documentation navigator. Given a Table of Contents and a user question, pick the most relevant section IDs.

TABLE OF CONTENTS:
${toc}

QUESTION: ${question}

Return ONLY a JSON array of node IDs (the part in brackets). Pick 1–5 most relevant nodes.
Example: ["admin.brand.category-baseline", "admin.brand.item-baseline"]
Return valid JSON only, no explanation.`;

  console.log("Scanning TOC with prompt:", prompt);

  const text = await generate(prompt);

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const ids = JSON.parse(clean);
    if (Array.isArray(ids)) return ids as string[];
    throw new Error("not an array");
  } catch {
    console.error(
      "Could not parse node IDs, falling back to top-level nodes. LLM said:",
      text
    );
    return tree.root.children.map((n) => n.id);
  }
}

// ─── Step 2: Answer Generation ────────────────────────────────────────────────
// Gemini reads the full content of retrieved nodes and answers the question.

async function generateAnswer(
  question: string,
  content: string
): Promise<string> {
  const prompt = `Answer the user's question using only the documentation below.
Be specific — name exact features, flags, and options mentioned.
If the docs don't fully cover the question, say so.

DOCUMENTATION:
${content}

QUESTION: ${question}`;

  console.log("Generating answer with prompt:", prompt);

  return generate(prompt);
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface RagResult {
  answer: string;
  nodeIds: string[]; // which nodes were retrieved
  content: string; // the raw content that was fed to the LLM
}

export async function query(
  tree: DocumentTree,
  question: string
): Promise<RagResult> {
  console.log("RAG query received. Question:", question);
  const nodeIds = await scanTOC(tree, question);
  const content = fetchNodeContent(tree, nodeIds);
  const answer = await generateAnswer(question, content);
  return { answer, nodeIds, content };
}
