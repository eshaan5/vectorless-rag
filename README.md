# Vectorless RAG

A documentation Q&A REST API built without vectors, embeddings, or a vector database. Instead of treating documents as bags of text chunks, it builds a hierarchical tree from your CSV and uses an LLM to navigate it — exactly like a human would scan a table of contents.

---

## What is PageIndex?

This project is a TypeScript implementation of the **PageIndex** approach, originally proposed by VectifyAI.

PageIndex is a research idea, not a plug-and-play library. The core claim is: instead of treating a document as a bag of chunks, treat it as a tree and navigate it like a human would. That is the entire idea.

Traditional RAG frameworks like LangChain or LlamaIndex are tools you install and call. PageIndex is an algorithm you implement. What this project does is take that algorithm, rebuild it in TypeScript, adapt it to a structured CSV format, and wrap it in a real HTTP API.

---

## Why not vector RAG?

|                                             | Vector RAG                      | This (Vectorless)                |
| ------------------------------------------- | ------------------------------- | -------------------------------- |
| How it finds relevant content               | Cosine similarity of embeddings | LLM reads the TOC and reasons    |
| Needs a vector DB                           | Yes                             | No                               |
| Understands document structure              | No                              | Yes                              |
| Explainable (why did it pick this section?) | No                              | Yes — node IDs are returned      |
| Works well with structured docs             | Often misses                    | Follows the hierarchy explicitly |

Vector retrieval assumes the most semantically similar text is also the most relevant. That is not always true, especially in structured domain-specific documentation where many sections share near-identical language but differ critically in meaning.

---

## How it works

### Your CSV structure

The input is a CSV with four columns:

| Column        | What it is                                                 |
| ------------- | ---------------------------------------------------------- |
| `Module`      | Top-level app module (e.g. Admin, Stock, Reports)          |
| `Level`       | Section within that module (e.g. Brand, Billing, Settings) |
| `Topic`       | The specific feature name                                  |
| `Description` | Full description of the feature                            |

### The tree

On load, the CSV is parsed into a three-level tree:

```
Admin
  └── Brand
        ├── Category (Baseline)
        ├── Item (Baseline)
        └── Tax (Baseline)
  └── Billing
        └── ...
Stock
  └── Stock Operations
        └── ...
```

### The two-step pipeline

When you ask a question, two LLM calls happen:

**Step 1 — TOC Scan**

The tree is serialized into a flat table of contents (node IDs and labels only, no descriptions) and sent to the LLM along with your question. The LLM reasons over the structure and returns the IDs of the most relevant nodes.

```
[admin] Admin
  [admin.brand] Brand
    [admin.brand.category-baseline] Category (Baseline)
    [admin.brand.item-baseline] Item (Baseline)

Question: "What are the addon category properties?"
LLM returns: ["admin.brand.category-baseline"]
```

No vectors. No similarity scores. The LLM navigates like a human scanning a table of contents.

**Step 2 — Answer Generation**

The full description text of the retrieved nodes is fetched and sent to the LLM with the original question. The LLM generates a specific, grounded answer from that content.

---

## What this project has vs the original PageIndex repo

| Feature                 | PageIndex repo | This project |
| ----------------------- | -------------- | ------------ |
| Core two-step algorithm | Yes            | Yes          |
| Language                | Python         | TypeScript   |
| Input format            | PDF / images   | CSV          |
| REST API                | No             | Yes          |
| Plug-and-play           | No             | No           |
| Tree persistence        | Yes            | Not yet      |

---

## Setup

```bash
npm install
```

Create a `.env` file at the root:

```
GROQ_API_KEY=your_key_here
```

Get a free Groq API key (no credit card) at **console.groq.com**.

Start the server:

```bash
npm run dev
```

---

## API

### `POST /load`

Load a CSV file and build the document tree.

```bash
curl -X POST http://localhost:3000/load \
  -H "Content-Type: application/json" \
  -d '{ "filePath": "./your-docs.csv" }'
```

### `POST /query`

Ask a question. Returns the answer and which nodes were retrieved.

```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{ "question": "What are the addon category properties?" }'
```

Add `"showSources": true` to also get the raw retrieved content in the response.

### `GET /tree`

Inspect the full table of contents of the loaded document.

### `GET /status`

Check what document is currently loaded.

---

## Project structure

```
src/
  index.ts     Express HTTP server and route handlers
  parser.ts    CSV to tree builder and TOC generator
  rag.ts       Two-step LLM pipeline (TOC scan and answer generation)
```

---

## What is left to make this production-ready

The main gap is **tree persistence**. Right now the tree lives in memory and is lost on every restart, which means re-loading the CSV each time. The fix is to serialize the parsed tree to a JSON file (or Redis) and check a hash of the CSV on startup — only re-parsing if the file has actually changed.
