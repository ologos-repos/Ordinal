# Ordinal Ontology Guide

**For Worker Agents Working on the Ordinal App**

This guide explains the hierarchical YAML format, ontology rules, and container detection system. Read this before working on ontology-related code to avoid breaking the container system.

---

## 1. The YAML Format

### Top-Level Structure

Every valid `.ologic` file MUST have `logic:` as the top-level key:

```yaml
logic:
  mode: knowledge           # Required: knowledge | automation | diagramming
  version: '2.0'           # Required: Always '2.0'
  networks:                # Entry point 1: Full hierarchy
  factories:               # Entry point 2: Factory-level
  machines:                # Entry point 3: Machine-level
```

### Three Entry Points

You can define your logic at any of three levels:

1. **networks:** — Full hierarchy (networks → factories → machines → nodes)
2. **factories:** — Skip networks, start at factory level
3. **machines:** — Skip networks and factories, define machines directly

Only ONE of these three entry points should be used per file.

### Mode Field

The `mode` field determines how the logic is executed:

- **knowledge** — Knowledge Factory mode (AI pipelines, context propagation)
- **automation** — Automation mode (workflow orchestration, Rhode tasks)
- **diagramming** — Diagramming mode (architecture visualization, PNG export)

---

## 2. Hierarchy Rules (with Examples)

The ontology follows a strict 4-level hierarchy:

**Networks → Factories → Machines → Nodes**

### Level 4: Machine (smallest container, holds nodes)

A **machine** is a connected component of nodes — nodes that have direct edges between them within one logical group.

```yaml
logic:
  mode: knowledge
  version: '2.0'
  machines:
    - id: new-machine
      nodes:
        - id: input-1
          type: input
          content: "Input"
          x: 50
          y: 100
          outputs:
            - output-1        # Connection WITHIN the same machine
        - id: output-1
          type: output
          content: "Output"
          x: 350
          y: 100
          inputs:
            - input-1         # Connection WITHIN the same machine
```

**Key points:**
- Nodes reference each other by `id` in their `inputs` and `outputs` arrays
- All connections are within the same `machines:` block
- Coordinates (`x`, `y`) are absolute pixel positions on the canvas

### Level 3: Factory (machine connects to an external node)

A **factory** emerges when a machine connects to an **external node** — a node that lives outside the machine, at the factory level. The pattern is always: **container → external node = next hierarchy level**.

A factory does NOT require multiple machines. It requires a machine + an external node it connects to.

```yaml
logic:
  mode: knowledge
  version: '2.0'
  factories:
    - id: my-factory
      machines:
        - id: machine-1
          nodes:
            - id: input-1
              type: input
              content: "Machine 1 Input"
              outputs:
                - process-1
            - id: process-1
              type: process
              content: "Process"
              inputs:
                - input-1     # Within machine-1
      nodes:                    # ← Factory-level nodes (outside any machine)
        - id: bridge-node
          type: process
          content: "Bridge"
          inputs:
            - machine-1         # ← machine→node connection = FACTORY
```

**Critical detail:** `bridge-node` is at factory level (in the factory's `nodes:` array, not inside any machine). It has `inputs: [machine-1]` — referencing the **machine ID**. This machine→node connection is what creates the factory.

**Multi-machine factory:**

```yaml
factories:
  - id: my-factory
    machines:
      - id: machine-1
        nodes:
          - id: m1-input
            type: input
            outputs: [m1-process]
          - id: m1-process
            type: process
            inputs: [m1-input]
      - id: machine-2
        nodes:
          - id: m2-output
            type: output
    nodes:                        # ← Bridge node connects both machines
      - id: bridge
        type: process
        inputs: [machine-1]       # ← From machine-1
        outputs: [machine-2]      # ← To machine-2
```

The bridge node takes input from `machine-1` and outputs to `machine-2`, forming a single factory. Without this bridge node, the two machines would be disconnected.

### Level 2: Network (container connects to an external node)

A **network** emerges when a factory or machine connects to an **external node** — a node that lives outside the container, at the network level. Same pattern: **container → external node = next hierarchy level**.

A network can contain **both factories AND standalone machines**. Network-level bridge nodes can reference **factory IDs or machine IDs**. A network does NOT require multiple factories — it just requires a container (factory or machine) + an external node it connects to.

**Full Network Blueprint (factories + standalone machine):**

```yaml
logic:
  mode: knowledge
  version: '2.0'
  networks:
    - id: my-network
      factories:
        - id: factory-1
          machines:
            - id: f1-machine
              nodes:
                - id: f1-input
                  type: input
                  content: "Factory 1 Input"
                  outputs: [f1-process]
                - id: f1-process
                  type: process
                  content: "Process"
          nodes:                        # Factory-level bridge
            - id: f1-bridge
              type: process
              inputs: [f1-machine]      # machine→node = factory
      machines:                          # ← Standalone machines (not in any factory)
        - id: standalone-machine
          nodes:
            - id: sm-input
              type: input
              content: "Standalone Input"
              outputs: [sm-output]
            - id: sm-output
              type: output
              content: "Standalone Output"
      nodes:                            # ← Network-level bridge nodes
        - id: network-hub
          type: process
          content: "Network Hub"
          inputs: [factory-1, standalone-machine] # ← factory→node AND machine→node = NETWORK
```

**Key observation:** `network-hub` is at network level (in the network's `nodes:` array, not inside any factory or machine). It has `inputs: [factory-1, standalone-machine]` — referencing **both a factory ID and a machine ID**. These container→node connections are what creates the network. Networks can mix factories and standalone machines freely.

### The Recursive Pattern

The hierarchy rule is the **same pattern at every tier**:

| Level | What creates it | YAML pattern |
|-------|----------------|-------------|
| Machine | 2+ nodes with direct node→node edges | Nodes in same `machines[].nodes:` with `outputs: [other-node-id]` |
| Factory | Machine connects to an external node | Factory-level `nodes:` with `inputs: [machine-id]` |
| Network | Factory or machine connects to an external node | Network-level `nodes:` with `inputs: [factory-id]` or `inputs: [machine-id]` |

The `nodes:` arrays at factory/network level hold **bridge nodes** — nodes that aren't inside any child container but are connected to them. They form the boundary that triggers the next hierarchy level.

**Networks are special:** They can contain both factories AND standalone machines. A standalone machine at network level is one that doesn't belong to any factory. Network-level bridge nodes can reference either factory IDs or machine IDs — both create valid network connections.

---

## 3. Ontology Rules (CRITICAL)

### Container Definitions

- **Machine** = connected component of 2+ nodes with direct node→node edges
- **Factory** = a machine connected to an external node (a bridge node at factory level with `inputs: [machine-id]`)
- **Network** = a factory or machine connected to an external node (a bridge node at network level with `inputs: [factory-id]` or `inputs: [machine-id]`). Networks can contain both factories AND standalone machines.

The pattern is recursive: **container + external bridge node = next level up.**

### Bridge Nodes Form Container Boundaries

Nodes in a container's `nodes:` array (factory-level or network-level) are **bridge nodes**. They live outside any child container but are connected to them via `inputs`/`outputs` referencing container IDs. These connections trigger hierarchy detection.

**A factory requires a machine connected to a bridge node — NOT multiple machines connected to each other.**

If a factory has multiple machines, each machine should connect to a bridge node (or chain of bridge nodes) at the factory level. Machines that have no path through a bridge node are disconnected from the factory.

### No Disconnected Containers

Every machine in a multi-machine factory MUST be reachable via a bridge node. If a machine has no connection to any factory-level bridge node and no connection to another machine's bridge path, it should be in a separate factory.

Similarly, every factory or standalone machine in a network MUST be referenced by at least one network-level bridge node. Bridge nodes at network level can reference factory IDs or machine IDs.

### Correct Factory Pattern

```yaml
factories:
  - id: my-factory
    machines:
      - id: machine-1
        nodes: [...]
      - id: machine-2
        nodes: [...]
    nodes:                          # ← Bridge nodes at factory level
      - id: bridge
        type: process
        inputs: [machine-1]        # ← machine→bridge = factory connection
        outputs: [machine-2]       # ← bridge→machine = connects both
```

### What Does NOT Create a Factory

```yaml
# WRONG — no bridge node, just two disconnected machines in a factory wrapper
factories:
  - id: not-a-real-factory
    machines:
      - id: machine-1
        nodes: [...]
      - id: machine-2
        nodes: [...]
    # No factory-level nodes: — machines are islands
```

This will pass validation but generate a warning: the factory wrapper is semantically empty because no bridge node connects the machines.

### Explicit Machine Boundaries (from YAML)

When the YAML specifies explicit `machines:` blocks with `id` values, the ontology detection **RESPECTS those boundaries**. The Union-Find algorithm does NOT merge nodes from different explicit machines, even if they're connected.

**How it works:**

1. During YAML load (`clipboard.js`), nodes are tagged with `explicitMachineId` (the machine ID from the YAML structure)
2. The ontology detection (`ontology.js` → `detectMachines()`) checks if any nodes have `explicitMachineId`
3. If yes, it uses **EXPLICIT MODE** — groups nodes by their `explicitMachineId`, preserving YAML structure
4. If no, it uses **IMPLICIT MODE** — runs Union-Find on connections to discover connected components

This ensures hierarchical YAML like this:

```yaml
logic:
  factories:
    - id: my-factory
      machines:
        - id: machine-A
          nodes: [...]
        - id: machine-B
          nodes: [...]
```

...will create exactly 2 machines (`machine-A` and `machine-B`), even if nodes in A and B are connected. The connection creates a **factory boundary**, not a machine merge.

---

## 4. Node Types

All available node types with their icons and accent colors (Catppuccin Mocha palette):

### Automation Mode: Agent Graph

| Type | Label | Icon | Color |
|------|-------|------|-------|
| `input` | Input | ✏️ | `#89b4fa` (blue) |
| `worker` | Worker | 🔧 | `#a6e3a1` (green) |
| `orchestrator` | Orchestrator | 🎭 | `#cba6f7` (mauve) |
| `oracle` | Oracle | 👁️ | `#f9e2af` (yellow) |
| `process` | Process | ⚙️ | `#94e2d5` (teal) |
| `output` | Output | 📤 | `#fab387` (peach) |

### Automation Mode: Action Graph

| Type | Label | Icon | Color |
|------|-------|------|-------|
| `trigger` | Trigger | ▶️ | `#a6e3a1` (green) |
| `bash` | Bash | 💻 | `#89b4fa` (blue) |
| `python` | Python | 🐍 | `#f9e2af` (yellow) |
| `variable` | Variable | 📦 | `#94e2d5` (teal) |
| `approval` | Approval | ✅ | `#f38ba8` (red) |
| `artifact` | Artifact | 📦 | `#fab387` (peach) |

### Diagramming Mode

| Type | Label | Icon | Color |
|------|-------|------|-------|
| `static` | Static | 📄 | `#a6e3a1` (green) |
| `source` | Source | 📥 | `#fab387` (peach) |
| `decision` | Decision | ❓ | `#f9e2af` (yellow) |
| `ai` | AI | 🤖 | `#cba6f7` (mauve) |
| `server` | Server | 🖥️ | `#89b4fa` (blue) |
| `database` | Database | 🗄️ | `#a6e3a1` (green) |
| `api` | API | 🔌 | `#94e2d5` (teal) |
| `cloud` | Cloud | ☁️ | `#89dceb` (sky) |
| `container` | Container | 📦 | `#89b4fa` (blue) |
| `queue` | Queue | 📮 | `#fab387` (peach) |
| `cache` | Cache | ⚡ | `#f9e2af` (yellow) |
| `gateway` | Gateway | 🚪 | `#94e2d5` (teal) |
| `firewall` | Firewall | 🛡️ | `#f38ba8` (red) |
| `loadbalancer` | Load Balancer | ⚖️ | `#cba6f7` (mauve) |
| `user` | User | 👤 | `#89b4fa` (blue) |
| `monitor` | Monitor | 📊 | `#a6e3a1` (green) |
| `default` | Node | ○ | `#6c7086` (overlay0) |

### Knowledge Factory Mode

| Type | Label | Icon | Color |
|------|-------|------|-------|
| `input` | Input | ✏️ | `#89b4fa` (blue) |
| `static` | Static | 📄 | `#a6e3a1` (green) |
| `ai` | AI | 🤖 | `#cba6f7` (mauve) |
| `text_file_source` | Text File Source | 📄 | `#fab387` (peach) |
| `pdf_file_source` | PDF File Source | 📕 | `#f38ba8` (red) |
| `text_file_output` | Text File Output | 📝 | `#a6e3a1` (green) |

**Note:** All colors use the Catppuccin Mocha theme. Border colors match the accent colors.

---

## 5. Connection References

How connections work in the YAML format:

### Node-Level Connections (within a machine)

```yaml
- id: node-a
  outputs:
    - node-b         # FROM node-a TO node-b

- id: node-b
  inputs:
    - node-a         # FROM node-a TO node-b (same connection, different perspective)
```

- `inputs: [node-id]` — connects FROM that node TO this node
- `outputs: [node-id]` — connects FROM this node TO that node
- Both create the same edge in the graph (directional: A → B)

### Container→Node Connections (creates hierarchy)

Bridge nodes at factory or network level reference container IDs in their `inputs`/`outputs`:

```yaml
# Factory-level bridge node — references a machine ID
nodes:
  - id: bridge-node
    inputs:
      - machine-id     # FROM machine TO bridge-node (machine→node = factory)
```

- When a factory-level node references a **machine ID**, it creates a **machine→node connection**
- This connection forms the factory — the machine and bridge node are now part of the same factory

```yaml
# Network-level bridge node — references a factory ID or machine ID
nodes:
  - id: network-bridge
    inputs:
      - factory-id     # FROM factory TO bridge-node (factory→node = network)
      - machine-id     # FROM machine TO bridge-node (machine→node = network, also valid)
```

- When a network-level node references a **factory ID** or **machine ID**, it creates a **container→node connection**
- This connection forms the network — the container and bridge node are now part of the same network
- Networks can contain both factories and standalone machines — bridge nodes can reference either type

### Connection Direction

- `inputs: [container-id]` — data flows FROM the container INTO this node
- `outputs: [container-id]` — data flows FROM this node INTO the container
- Both establish the container→node relationship that triggers hierarchy detection

---

## 6. Key Files

If you're working on the ontology system, these are the files you need to understand:

### Container Detection & Ontology

**`src/stores/workflows/ontology.js`**
- Main entry point: `detectContainers(nodeList, connectionList)`
- Implements Union-Find algorithm for container detection
- **EXPLICIT MODE** (lines 72-100): Respects `explicitMachineId` tags from hierarchical YAML
- **IMPLICIT MODE** (lines 103+): Discovers connected components via Union-Find
- Functions:
  - `detectMachines()` — finds machines (connected components of nodes)
  - `detectFactories()` — finds factories (machine→node connections at factory level)
  - `detectNetworks()` — finds networks (factory→node connections at network level)

### YAML Loading & Parsing

**`src/lib/clipboard.js`**
- 2800+ line hierarchical YAML paste/reconstruct pipeline
- `pasteAndCreateConfigUniversal()` (lines 1700+) — main entry point for YAML loading
- `createNodesRecursive()` (lines 1906-2004) — recursively creates nodes from `UniversalContainer` tree
- **Lines 1922-1925:** Tags nodes with `explicitMachineId` during hierarchical load
- This is where nodes get their explicit machine membership for ontology detection

**CRITICAL:** When nodes are created from hierarchical YAML (`logic: → networks: → factories: → machines:`), they are tagged with `node.explicitMachineId = <machine-id>`. This tells the ontology detection to respect YAML boundaries instead of merging via Union-Find.

### Container Data Structure

**`src/lib/UniversalContainer.js`**
- Base class for all containers (networks, factories, machines, nodes)
- Represents a node in the hierarchical tree during YAML load
- Properties:
  - `type` — "network" | "factory" | "machine" | "node"
  - `id` — unique identifier
  - `children` — array of child `UniversalContainer` objects
  - `config` — node-specific data (nodeType, content, filePath, etc.)
  - `coordinates` — `{x, y}` position on canvas

### Hierarchical Integrity Enforcement

**`src/lib/OntologyMonitor.js`**
- Validates hierarchical integrity rules
- Prevents orphaned containers (machines without factories, factories without networks)
- Enforces parent-child relationships in the ontology tree
- **Warning system:** Logs console warnings when integrity violations are detected

### Blueprint Templates (Canonical YAML Examples)

**`src/stores/templates.js`**
- Lines 506-654: Structure templates for all hierarchy levels
- `'structure-network'` (lines 587-654) — Canonical network blueprint (see Section 2.3 above)
- `'structure-factory'` — Factory blueprint with 2 machines
- `'structure-machine'` — Single machine blueprint
- These templates are THE reference implementations — when in doubt, copy their YAML structure

---

## 7. Common Pitfalls & Debugging

### Pitfall 1: Containers Not Detected After YAML Load

**Symptom:** Loading a YAML file creates nodes and connections, but ontology detection finds 0 containers. Organize algorithm fails.

**Root cause:** Container detection runs in a Svelte derived store that updates when `$workflow.nodes` or `$workflow.connections` change. YAML load may call `organize()` before the derived store has time to detect containers.

**Fix:** Ensure `clipboard.js` waits for container detection before calling `organize()`. Check for the polling loop (30 attempts, 100ms intervals) that waits for containers.

### Pitfall 2: Machines Incorrectly Merged

**Symptom:** Loading hierarchical YAML with explicit `machines:` blocks, but all nodes merge into one machine.

**Root cause:** Nodes are missing `explicitMachineId` tags. Check `clipboard.js` line 1922-1925 — ensure `createNodesRecursive()` is called with `parentMachineId` parameter.

**Fix:** Verify the hierarchical YAML is using the correct structure (`logic: → machines:`). Check console logs for "🏷️ Tagged node X with explicit machine: Y" messages.

### Pitfall 3: Disconnected Machines in Same Factory

**Symptom:** Factory contains machines with no connections to factory-level bridge nodes.

**Root cause:** Missing bridge nodes. A factory requires at least one factory-level node that references a machine ID — without this, the machines are disconnected islands.

**Fix:** Add a factory-level `nodes:` array with a bridge node that has `inputs: [machine-id]` or `outputs: [machine-id]`. If machines truly don't interact, they should be separate factories.

### Debugging Tools

1. **Browser Console:**
   - Search for `🏷️ Ontology:` logs — shows explicit vs implicit mode
   - Search for `✅ Created machine X with Y nodes` — shows machine detection
   - Search for `🏷️ Tagged node X with explicit machine: Y` — shows node tagging

2. **Svelte DevTools:**
   - Inspect `$workflowContainers` store — shows detected machines/factories/networks
   - Inspect `$workflow.nodes` — check for `explicitMachineId` property

3. **Template Comparison:**
   - Load a working blueprint from `templates.js`
   - Compare its YAML structure to your custom YAML
   - Check for structural differences (nesting, connection references)

---

## 8. Best Practices

### When Writing YAML

1. **Always include `logic:` as the top-level key**
2. **Always include `mode:` and `version: '2.0'`**
3. **Use consistent ID naming:**
   - Machines: `machine-1`, `machine-2`, or `f1-machine-1` (for factory 1, machine 1)
   - Nodes: `input-1`, `process-2`, or `f1-m1-input` (factory 1, machine 1, input)
4. **Include coordinates (`x`, `y`) for all nodes** — even if you plan to use organize, explicit positions help with debugging
5. **Test with blueprints first** — load a working template from `templates.js`, then modify incrementally

### When Modifying Ontology Code

1. **Never skip explicit mode checks** — always check for `explicitMachineId` before running Union-Find
2. **Preserve YAML hierarchy** — if YAML says "this is machine A", the ontology MUST respect that
3. **Log liberally** — console logs are your friend when debugging container detection
4. **Test all three entry points** — test with `networks:`, `factories:`, and `machines:` YAML files
5. **Check the board** — before touching `ontology.js` or `clipboard.js`, post to the message board to avoid conflicts

### When Testing

1. **Test scale** — 5 nodes, 23 nodes, 50+ nodes
2. **Test hierarchy depth** — single machine, factory, full network
3. **Test bridge node connections** — verify machine→node and factory→node connections create correct factory/network boundaries
4. **Test organize algorithm** — after loading YAML, verify organize produces clean, non-overlapping layouts
5. **Test mode switching** — verify ontology works in Knowledge, Automation, and Diagramming modes

---

## 9. Quick Reference: YAML Skeleton

### Machine-Level Entry

```yaml
logic:
  mode: knowledge
  version: '2.0'
  machines:
    - id: machine-1
      nodes:
        - id: input-1
          type: input
          content: "Text"
          x: 100
          y: 100
          outputs: [process-1]
        - id: process-1
          type: process
          content: "Text"
          x: 300
          y: 100
          inputs: [input-1]
```

### Factory-Level Entry

```yaml
logic:
  mode: knowledge
  version: '2.0'
  factories:
    - id: factory-1
      machines:
        - id: machine-1
          nodes:
            - id: m1-input
              type: input
              outputs: [m1-process]
            - id: m1-process
              type: process
      nodes:                          # ← Factory-level bridge nodes
        - id: bridge
          type: process
          inputs: [machine-1]         # ← machine→node = factory
```

### Network-Level Entry

```yaml
logic:
  mode: knowledge
  version: '2.0'
  networks:
    - id: network-1
      factories:
        - id: factory-1
          machines:
            - id: f1-machine
              nodes: [...]
          nodes:
            - id: f1-bridge
              inputs: [f1-machine]    # ← machine→node = factory
      machines:                        # ← Standalone machines (not in any factory)
        - id: standalone-machine
          nodes: [...]
      nodes:                          # ← Network-level bridge nodes
        - id: net-hub
          type: process
          inputs: [factory-1, standalone-machine]  # ← factory/machine→node = network
```

Networks can contain `factories:` AND/OR `machines:` at the same level. Bridge nodes at network level can reference either factory IDs or machine IDs.

---

## 10. Summary

**For Worker Agents:**

- The YAML format is **hierarchical and explicit** — respect the structure
- Ontology detection has **two modes** (explicit and implicit) — understand when each triggers
- Containers have **strict rules** — bridge nodes required, no disconnected containers
- Networks can contain **factories AND/OR standalone machines** — bridge nodes reference either
- The hierarchy pattern is always **container → external bridge node = next level up**
- When in doubt, **copy from `templates.js`** — those are the canonical examples
- Before touching ontology code, **read the board** and **check recent commits** — avoid conflicts

**The Golden Rule:**

> If the YAML says "this is machine A", the ontology MUST create a container called "machine A" with exactly the nodes the YAML specified. Container→node connections (bridge nodes) create factories/networks, not container merges.

**Further Reading:**

- Rhode.Notes task history: #655 (ontology Union-Find fix), #653 (container detection diagnosis)
- Message board channel: `#ordinal-testing` — recent ontology discussion
- Commit `01d25a6` — explicit machine boundary implementation

---

**End of Ordinal Ontology Guide**

*Last updated: 2026-02-22 by Rhode-Prime — networks can contain factories AND/OR standalone machines; bridge nodes reference either type*
