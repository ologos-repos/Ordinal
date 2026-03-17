# Ordinal

A visual node-based graph editor for modeling, visualizing, and executing complex systems through hierarchical container-based ontologies.

## What It Does

Ordinal is a multi-mode visual editor that operates on a **4-level container hierarchy**: Networks > Factories > Machines > Nodes. You build graphs by connecting nodes, and the system automatically discovers semantic boundaries using Union-Find algorithms.

Three operating modes, same canvas:

- **Knowledge Mode** — AI completion pipelines. Connect text/PDF sources through AI processing nodes to file outputs. Token counting tracks LLM context size in real-time.
- **Automation Mode** — Agent orchestration graphs. Workers, orchestrators, oracles, and action nodes with human-in-the-loop oracle gates for pause points during execution.
- **Diagramming Mode** — Architecture visualization with 20+ node types (server, database, API, cloud, gateway, container, queue, cache, firewall, and more).

## Ontology System

The core concept: **connected components form hierarchy automatically**.

| Level | What It Is | How It Forms |
|-------|-----------|--------------|
| **Node** | Atomic unit | Always exists |
| **Machine** | 2+ connected nodes | Node-to-node edges (Union-Find merge) |
| **Factory** | Machine + external bridge node | A node inside one machine has `inputs: [other-machine-id]` |
| **Network** | Factory + external bridge entity | A node inside a factory has `inputs: [other-factory-id]` |

The key pattern: **a bridge node inside a downstream container with `inputs:` pointing to an upstream container triggers the next hierarchy level.** This gives you semantic boundaries without explicit nesting.

## Blueprint Format (`.ologic`)

Graphs are defined in YAML and can be loaded, saved, and shared:

```yaml
logic:
  mode: diagramming
  version: '2.0'
  factories:
    - id: my-factory
      machines:
        - id: pipeline
          nodes:
            - id: ingest
              type: source
              title: Ingest
              outputs: [process]
            - id: process
              type: process
              title: Process
      nodes:
        - id: monitor
          type: monitor
          title: Monitor
          inputs: [pipeline]
```

17 built-in templates cover common patterns across all three modes.

## Tech Stack

- **Frontend**: Svelte 4 + Vite
- **Canvas**: Custom drag/pan/zoom with bezier connections, box selection, context menus
- **Ontology**: Union-Find detection (implicit from connections) + explicit YAML hierarchy preservation
- **Backend**: Rhode API integration for AI completion, settings, graph CRUD
- **Theme**: Catppuccin Mocha

## Running

```bash
npm install
npm run dev
```

## Integration

Ordinal serves as the visual layer for the [Ordinal-MCP](https://github.com/bobbyhiddn/Ordinal-MCP) server, which provides `.ologic` model validation, rendering, and pipeline execution as MCP tools. The MCP server can be used independently for headless model processing.

## License

MIT
