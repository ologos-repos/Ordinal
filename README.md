# Ordinal

A visual node-based graph editor for modeling, visualizing, and executing complex systems through hierarchical container-based ontologies.

Ordinal is a standalone Svelte 4 SPA served by Rhode's web server. You build graphs by placing nodes, drawing connections, and letting the system automatically discover semantic hierarchy using Union-Find algorithms. Graphs are saved as `.ologic` YAML blueprints and can be loaded, shared, validated, and executed headlessly via Ordinal-MCP.

---

## Three Modes

Ordinal operates in three distinct modes on the same canvas. Switch modes from the toolbar — the node palette and available types change to match.

### Knowledge Mode

Build AI completion pipelines. Connect document sources through AI processing nodes to file outputs. Token counting tracks LLM context size in real-time so you can stay within model limits.

**Node types**: `input`, `static`, `ai`, `text_file_source`, `pdf_file_source`, `text_file_output`, `source`, `process`, `output`

Typical pattern: text or PDF sources feed into an AI node (with a prompt template), which writes to a text file output. Chain multiple AI nodes for multi-step processing pipelines.

### Automation Mode

Build agent orchestration graphs. Two sub-modes:

**Agent Graph** — Model multi-agent systems. Place workers, orchestrators, oracles (human-in-the-loop gates), and process nodes. Oracles represent decision points where a human must approve before execution continues.

**Action Graph** — CI/CD style automation. Triggers kick off sequences of bash or Python script nodes, with variables, approval gates, and artifact outputs. Good for modeling deployment pipelines, scheduled jobs, and approval workflows.

### Diagramming Mode

Architecture visualization. 20+ node types cover the full range of infrastructure and system design:

`server`, `database`, `api`, `cloud`, `container`, `queue`, `cache`, `gateway`, `firewall`, `loadbalancer`, `user`, `monitor`, `static`, `source`, `decision`, `ai`, `process`, `worker`, `orchestrator`, `oracle`, `default`

Use this mode to document system architecture, communicate designs, or model the topology of a running system.

---

## Ontology System

The core concept: **connected components form hierarchy automatically**.

| Level | What It Is | How It Forms |
|-------|------------|--------------|
| **Node** | Atomic unit | Always exists as a standalone element |
| **Machine** | 2+ connected nodes | Direct node-to-node edges; Union-Find merges transitively connected nodes |
| **Factory** | Machine + external bridge node | A standalone node with `inputs: [machine-id]` creates a cross-machine connection |
| **Network** | Factory + external bridge entity | A standalone node with `inputs: [factory-id]` creates a cross-factory connection |

**The key pattern**: a bridge node declared *outside* a container, with `inputs:` pointing to that container's ID, triggers promotion to the next hierarchy level. This gives you semantic boundaries without explicit wrapping.

Detection runs in two modes:

- **Implicit** — hierarchy is derived entirely from connection topology using Union-Find. No nesting required in the YAML.
- **Explicit** — YAML hierarchy is preserved as written. When you load a blueprint that declares `networks:` > `factories:` > `machines:`, Ordinal respects that structure rather than re-deriving it.

Both validators (frontend JS and backend Python) enforce the same ontology rules.

---

## Blueprint Format (`.ologic`)

Graphs are stored as YAML blueprints with a `.ologic` extension. The root key is `logic:`, with `mode:` and `version:` set at the top level.

```yaml
logic:
  mode: diagramming
  version: '2.0'
  factories:
    - id: web-stack
      machines:
        - id: frontend
          nodes:
            - id: cdn
              type: cloud
              title: CDN
              outputs: [gateway]
            - id: gateway
              type: gateway
              title: API Gateway
              outputs: [api]
            - id: api
              type: api
              title: REST API
      nodes:
        - id: db
          type: database
          title: Postgres
          inputs: [frontend]
        - id: cache
          type: cache
          title: Redis
          inputs: [frontend]
```

This produces a factory (`web-stack`) containing one machine (`frontend`) with three nodes, plus two bridge nodes (`db`, `cache`) that connect into the machine — triggering factory-level detection.

Ordinal ships with **29 built-in templates** covering common patterns across all three modes. Load any template from the palette to get started immediately.

---

## Canvas Features

The canvas is a custom implementation — no third-party graph library.

| Feature | Details |
|---------|---------|
| **Pan / Zoom** | Infinite canvas with dot grid; scroll to zoom, drag to pan |
| **Node creation** | Drag from the palette or double-click canvas |
| **Connection drawing** | Drag from a node's output edge to another node's input |
| **Box selection** | Click-drag on empty canvas to select multiple nodes |
| **Multi-select** | Shift+Click to add/remove nodes from selection |
| **Context menus** | Right-click on nodes, edges, or canvas background |
| **Undo / Redo** | Full history stack |
| **Copy / Paste** | YAML clipboard integration — paste `.ologic` fragments directly |
| **Auto-layout** | Organize algorithm arranges nodes by hierarchy level |
| **Fit to screen** | One-click to fit the entire graph in view |
| **Minimap** | Overview navigator for large graphs |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Svelte 4 + Vite |
| **Canvas** | Custom implementation (pan, zoom, bezier connections, selection) |
| **Ontology** | Union-Find detection (implicit) + explicit YAML hierarchy preservation |
| **Backend** | Rhode API integration (AI completion, settings, graph CRUD) |
| **Theme** | Catppuccin Mocha |
| **Nodes** | Plugin architecture — node types are registered modules, extensible |

---

## Running

```bash
npm install
npm run dev      # Dev server (localhost:5173 by default)
npm run build    # Build and output to Rhode's static directory
```

In production, Ordinal is served by Rhode at `/ordinal/`.

---

## Validation

Ordinal uses a two-validator architecture:

- **Frontend (JS)** — runs on paste and load for instant feedback. Catches structural errors before any server round-trip.
- **Backend (Python)** — runs via Rhode's API and through Ordinal-MCP. Used for server-side validation, PLM enforcement, and pipeline execution.

Both validators enforce the same ontology rules: valid node types per mode, legal connection patterns, hierarchy consistency, and blueprint schema correctness.

---

## Integration

Ordinal is the visual layer in a three-part system:

| Component | Role |
|-----------|------|
| **Ordinal** | Visual graph editor (this repo) |
| **[Ordinal-MCP](https://github.com/bobbyhiddn/Ordinal-MCP)** | Headless MCP tool server — model validation, rendering, pipeline execution |
| **Rhode** | Backend API server — AI completion, graph storage, serving the SPA |

Ordinal-MCP can be used independently to validate `.ologic` blueprints, render graph images, and execute pipelines without the visual editor.

---

## License

MIT
