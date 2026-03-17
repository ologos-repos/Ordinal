# Ordinal Validation Architecture

## Overview

Ordinal's validation system ensures `.ologic` models are structurally sound and ontologically correct before they are rendered, executed, or stored in the PLM hierarchy. Validation exists in two canonical implementations that mirror each other, with clear separation of concerns between the frontend engine and the backend infrastructure.

---

## Architecture Layers

```
 Frontend (Ordinal App — Svelte)
 ================================
    clipboard.js
        |
        v
    OlogicValidator.js   <-- Canonical JS validator
        |                     (standalone, pure JS, no platform deps)
        v
    Canvas render pipeline

 Backend (Rhode — Starlette)
 ================================
    POST /ordinal/api/validate
        |
        v
    ologic_validator.py  <-- Canonical Python validator
        |                     (mirrors JS implementation)
        v
    PLM integration (products, projects, requirements)
```

### Layer 1: Frontend Validation (Ordinal)

**File:** `src/lib/OlogicValidator.js`

The canonical JavaScript validator. Pure functional design with a context-object pattern (no classes, no `this`). Works identically in browser and Node.js.

**Two-pass architecture:**
- **Pass 1 (Harvest + Intrinsic):** Walk the YAML tree, check types and required fields, collect all IDs, map node IDs to parent machine IDs.
- **Pass 2 (Relational):** Cross-references between nodes, cross-machine edge detection, factory/network connectivity checks.

**Integration point:** `clipboard.js` imports `validateOlogicSyntax()` and runs it on every paste/load before rendering to canvas. Invalid models are rejected with structured error messages.

### Layer 2: Backend Validation (Rhode)

**File:** `src/rhode/ologic_validator.py`

Python mirror of the JS validator with identical logic, constants, and error codes. Class-based design with classmethods (all static).

**Integration points:**
- `POST /ordinal/api/validate` — REST endpoint returning structured JSON results
- PLM `create_product` / `create_project` — Validates `ologic_model` before storing
- Ordinal-MCP `run_logic` / `execute_logic` — Validates before pipeline execution

### Layer 3: PLM Integration (Rhode)

**Requirement reconciliation** connects validation to the digital thread:
- `GET /projects/{id}/requirements/reconcile` — Checks model coverage against requirements DB
- `GET /products/{id}/requirements/reconcile` — Cascading check (product + all child projects)
- `POST /projects/{id}/requirements/derive` — Auto-derives requirements from source documents
- `reconcile_requirements()` MCP tool — Rhode-Prime can run reconciliation programmatically

---

## Validation Rules

### Structural Rules

| Code | Severity | Rule |
|------|----------|------|
| `MISSING_LOGIC_KEY` | error | Top-level `logic:` key required |
| `MISSING_MODE` | error | `mode` field required under `logic:` |
| `INVALID_MODE` | error | Mode must be: `knowledge`, `automation`, or `diagramming` |
| `UNSUPPORTED_VERSION` | warning | Version should be `2.0` (or `1.0` for legacy) |
| `MULTIPLE_ENTRY_POINTS` | error | Only one of `networks:`, `factories:`, `machines:` allowed |
| `NO_ENTRY_POINT` | error | At least one entry point required |

### ID Rules

| Code | Severity | Rule |
|------|----------|------|
| `DUPLICATE_ID` | error | All IDs must be unique across the entire model |
| `MISSING_ID` | error | Every node, machine, factory, and network must have an `id` |
| `EMPTY_ID` | error | IDs cannot be empty strings |

### Type Rules

| Code | Severity | Rule |
|------|----------|------|
| `MISSING_NODE_TYPE` | error | Every node must have a `type` (or `node_type`) field |
| `INVALID_NODE_TYPE` | error | Node type must be a recognized type |
| `WRONG_MODE_NODE_TYPE` | warning | Node type exists but is not valid for the current mode |

### Reference Rules

| Code | Severity | Rule |
|------|----------|------|
| `UNKNOWN_REF` | error | `inputs`/`outputs` must reference existing node IDs |
| `INVALID_IO_TYPE` | warning | `inputs`/`outputs` must be arrays of strings |

### Ontology Rules (Critical)

| Code | Severity | Rule |
|------|----------|------|
| `CROSS_MACHINE_NODE_EDGE` | error | Nodes CANNOT have direct edges across machine boundaries. All cross-machine connections must go through machine-level `inputs`/`outputs`. |
| `DISCONNECTED_MACHINES` | warning | Every machine in a factory must have at least one cross-machine connection (otherwise it's not a factory — it's just a loose machine) |
| `DISCONNECTED_FACTORIES` | warning | Every factory in a network must have at least one cross-factory connection |
| `CONTAINER_HAS_IO` | error | Machines/factories/networks cannot have `inputs`/`outputs` — only nodes can |
| `EMPTY_CONTAINER` | warning | Containers (machines, factories, networks) should not be empty |
| `UNNECESSARY_WRAPPER` | info | Single-item containers may be unnecessary nesting |
| `INVALID_EDGES_KEY` | error | Use `inputs`/`outputs` on nodes, not an `edges` key |

---

## Supported Modes & Node Types

### `knowledge` mode
AI pipelines, context propagation, knowledge factories.

Types: `input`, `static`, `ai`, `output`, `text_file_source`, `pdf_file_source`, `text_file_output`, `source`, `process`, `default`

### `automation` mode
Workflow orchestration, Rhode task pipelines.

Types: `input`, `worker`, `orchestrator`, `oracle`, `process`, `output`, `trigger`, `bash`, `python`, `variable`, `approval`, `artifact`, `default`

### `diagramming` mode
Architecture visualization, infrastructure diagrams.

Types: All automation types plus `static`, `source`, `decision`, `ai`, `server`, `database`, `api`, `cloud`, `container`, `queue`, `cache`, `gateway`, `firewall`, `loadbalancer`, `user`, `monitor`

---

## API Reference

### Frontend (JS)

```javascript
import { validateOlogic, validateOlogicSyntax, CODES } from './OlogicValidator.js';

// Structured result (preferred)
const result = validateOlogic(parsedYamlObject);
// result = { valid, errors[], warnings[], infos[], mode, nodeCount, machineCount, ... }

// Legacy flat errors (used by clipboard.js)
const errors = validateOlogicSyntax(parsedYamlObject);
// errors = string[] — empty means valid
```

### Backend (REST)

```http
POST /ordinal/api/validate
Content-Type: application/json

{
  "yaml": "logic:\n  mode: knowledge\n  machines:\n    ...",
  "strict": false
}

Response:
{
  "valid": true,
  "errors": [{ "path": "...", "message": "...", "hint": "..." }],
  "warnings": [...],
  "summary": "VALID  mode=knowledge  nodes=5  machines=2  errors=0",
  "mode": "knowledge",
  "node_count": 5,
  "machine_count": 2,
  "factory_count": 0,
  "network_count": 0
}
```

### PLM (MCP)

```
reconcile_requirements(project_id=N, cascade=true)
  -> { coverage_pct, orphan_requirements[], missing_from_model[], ... }
```

---

## Key Design Decisions

1. **Two canonical implementations, not one.** JS for the browser engine (instant feedback on paste/load), Python for the backend (API validation, PLM integration, MCP tools). They mirror each other and share the same constants and error codes.

2. **Validation lives in Ordinal, not the MCP.** The MCP is a tool interface. The engine owns its own correctness rules. The MCP calls into the validator, not the other way around.

3. **Ontology enforcement is non-negotiable.** Cross-machine node edges are the #1 source of invalid models. The validator catches this at every entry point — paste, load, API, and execution.

4. **Requirement tracing is a first-class concept.** Models can declare `requirements: [REQ-XX-NNN]` at any level. The PLM reconciliation system checks coverage bidirectionally — requirements that aren't traced to model nodes, and model nodes that reference nonexistent requirements.

5. **Strict mode is opt-in.** By default, warnings don't fail validation. Pass `strict: true` to the API to treat warnings as errors (useful for CI/CD or formal verification).
