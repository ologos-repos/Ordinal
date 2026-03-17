/**
 * OlogicValidator.js
 *
 * Standalone .ologic model validator — the canonical JS implementation.
 * Lives in Ordinal, not Rhode or the MCP.
 *
 * Architecture: Functional with Context Object (no class, no `this`).
 * Two-pass validation:
 *   Pass 1 — Harvest + Intrinsic: Walk the tree, check types/required fields,
 *             collect all IDs, map node IDs to parent machine IDs.
 *   Pass 2 — Relational: Cross-references, cross-machine edge detection,
 *             factory/network connectivity checks.
 *
 * Usage:
 *   import { validateOlogic } from './OlogicValidator.js';
 *   const result = validateOlogic(parsedYamlObject);
 *   if (!result.valid) { console.error(result.errors); }
 *
 * Note: Accepts pre-parsed JS objects. The caller must parse YAML first.
 * No fs, no window, no platform APIs — pure JS, works in Node and browser.
 *
 * @module OlogicValidator
 */

// ── Constants ──────────────────────────────────────────────────────────────────

/** Valid .ologic modes. Exported for consumers (e.g. clipboard.js). */
export const VALID_MODES = new Set(['knowledge', 'automation', 'diagramming']);
const SUPPORTED_VERSIONS = new Set(['2.0', '1.0']);

/** Node types valid per mode. Exported as canonical source. @type {Record<string, Set<string>>} */
export const NODE_TYPES_BY_MODE = {
    knowledge: new Set([
        'input', 'static', 'ai', 'output',
        'text_file_source', 'pdf_file_source', 'text_file_output',
        'source', 'process', 'default',
    ]),
    automation: new Set([
        'input', 'worker', 'orchestrator', 'oracle', 'process', 'output',
        'trigger', 'bash', 'python', 'variable', 'approval', 'artifact',
        'default',
    ]),
    diagramming: new Set([
        'static', 'source', 'decision', 'ai', 'server', 'database', 'api',
        'cloud', 'container', 'queue', 'cache', 'gateway', 'firewall',
        'worker', 'orchestrator', 'oracle',
        'trigger', 'bash', 'python', 'approval', 'artifact', 'variable',
        'loadbalancer', 'user', 'monitor', 'input', 'output', 'process',
        'default',
    ]),
};

/** All node types valid across any mode. Exported for consumers needing a flat set. */
export const VALID_NODE_TYPES = new Set(
    Object.values(NODE_TYPES_BY_MODE).flatMap(s => [...s])
);

/** @internal Alias for internal use */
const ALL_KNOWN_TYPES = VALID_NODE_TYPES;

const REQ_PATTERN = /^REQ-[A-Z0-9]+-\d+$/;

// Known keys at each container level (for unknown-key warnings)
const KNOWN_NETWORK_KEYS = new Set(['id', 'label', 'title', 'factories', 'machines', 'metadata', 'description', 'nodes', 'position']);
const KNOWN_FACTORY_KEYS = new Set(['id', 'label', 'title', 'machines', 'metadata', 'description', 'nodes', 'position']);
const KNOWN_MACHINE_KEYS = new Set(['id', 'label', 'title', 'nodes', 'metadata', 'description', 'position']);
const KNOWN_NODE_KEYS = new Set([
    'id', 'type', 'node_type', 'title', 'icon',
    'content', 'label', 'description',
    'inputs', 'outputs',
    'x', 'y', 'requirements',
    'filePath', 'file_path', 'model', 'temperature', 'system_prompt',
    'color', 'metadata', 'tags', 'position',
]);

// ── Error codes ────────────────────────────────────────────────────────────────

export const CODES = {
    MISSING_LOGIC_KEY: 'MISSING_LOGIC_KEY',
    INVALID_MODE: 'INVALID_MODE',
    MISSING_MODE: 'MISSING_MODE',
    UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
    MULTIPLE_ENTRY_POINTS: 'MULTIPLE_ENTRY_POINTS',
    NO_ENTRY_POINT: 'NO_ENTRY_POINT',
    DUPLICATE_ID: 'DUPLICATE_ID',
    MISSING_ID: 'MISSING_ID',
    EMPTY_ID: 'EMPTY_ID',
    INVALID_NODE_TYPE: 'INVALID_NODE_TYPE',
    WRONG_MODE_NODE_TYPE: 'WRONG_MODE_NODE_TYPE',
    MISSING_NODE_TYPE: 'MISSING_NODE_TYPE',
    INVALID_IO_TYPE: 'INVALID_IO_TYPE',
    UNKNOWN_REF: 'UNKNOWN_REF',
    CONTAINER_HAS_IO: 'CONTAINER_HAS_IO',
    INVALID_EDGES_KEY: 'INVALID_EDGES_KEY',
    CROSS_MACHINE_NODE_EDGE: 'CROSS_MACHINE_NODE_EDGE',
    DISCONNECTED_MACHINES: 'DISCONNECTED_MACHINES',
    DISCONNECTED_FACTORIES: 'DISCONNECTED_FACTORIES',
    EMPTY_CONTAINER: 'EMPTY_CONTAINER',
    UNNECESSARY_WRAPPER: 'UNNECESSARY_WRAPPER',
};

// ── Issue factory ──────────────────────────────────────────────────────────────

/**
 * @typedef {{ severity: 'error'|'warning'|'info', path: string, message: string, hint: string, code: string }} Issue
 */

/**
 * @param {'error'|'warning'|'info'} severity
 * @param {string} path
 * @param {string} message
 * @param {string} code
 * @param {string} [hint]
 * @returns {Issue}
 */
function issue(severity, path, message, code, hint = '') {
    return { severity, path, message, hint, code };
}

// ── Context helpers ────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   errors: Issue[],
 *   warnings: Issue[],
 *   infos: Issue[],
 *   allIds: Map<string, string>,
 *   nodeToMachine: Map<string, string>,
 *   counts: { nodes: number, machines: number, factories: number, networks: number },
 *   mode: string,
 *   version: string,
 *   entryPoint: string,
 * }} Context
 */

/** @returns {Context} */
function makeContext() {
    return {
        errors: [],
        warnings: [],
        infos: [],
        allIds: new Map(),       // id → path (for duplicate detection)
        nodeToMachine: new Map(), // nodeId → machineId (for cross-machine check)
        counts: { nodes: 0, machines: 0, factories: 0, networks: 0 },
        mode: '',
        version: '',
        entryPoint: '',
    };
}

/** @param {Context} ctx @param {string} path @param {string} message @param {string} code @param {string} [hint] */
function addError(ctx, path, message, code, hint) {
    ctx.errors.push(issue('error', path, message, code, hint));
}

/** @param {Context} ctx @param {string} path @param {string} message @param {string} code @param {string} [hint] */
function addWarning(ctx, path, message, code, hint) {
    ctx.warnings.push(issue('warning', path, message, code, hint));
}

/** @param {Context} ctx @param {string} path @param {string} message @param {string} code @param {string} [hint] */
function addInfo(ctx, path, message, code, hint) {
    ctx.infos.push(issue('info', path, message, code, hint));
}

// ── Pass 1: ID Harvesting ──────────────────────────────────────────────────────

/**
 * Recursively collect all 'id' fields across the document tree.
 * Detects duplicates and records path for each ID.
 * @param {any} obj
 * @param {string} path
 * @param {Context} ctx
 */
function collectIds(obj, path, ctx) {
    if (obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
        obj.forEach((item, i) => collectIds(item, `${path}[${i}]`, ctx));
        return;
    }

    if (typeof obj === 'object') {
        if ('id' in obj) {
            const idVal = obj.id;
            if (typeof idVal !== 'string') {
                addError(ctx, path, `'id' must be a string, got ${typeof idVal}: ${JSON.stringify(idVal)}`, CODES.MISSING_ID);
            } else if (!idVal.trim()) {
                addError(ctx, path, `'id' must not be empty.`, CODES.EMPTY_ID);
            } else if (ctx.allIds.has(idVal)) {
                addError(ctx, path,
                    `Duplicate ID '${idVal}' (first seen at: ${ctx.allIds.get(idVal)})`,
                    CODES.DUPLICATE_ID,
                    'All IDs must be unique within a file.'
                );
            } else {
                ctx.allIds.set(idVal, path);
            }
        }
        // Recurse into all values except 'id' itself
        for (const [key, value] of Object.entries(obj)) {
            if (key !== 'id') {
                collectIds(value, `${path}.${key}`, ctx);
            }
        }
    }
}

// ── Pass 1: Top-level checks ───────────────────────────────────────────────────

/** @param {any} doc @param {Context} ctx @returns {boolean} fatal */
function checkTopLevel(doc, ctx) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        addError(ctx, '', `Top-level value must be a mapping/object, got ${Array.isArray(doc) ? 'array' : typeof doc}.`, CODES.MISSING_LOGIC_KEY);
        return true;
    }
    if (!('logic' in doc)) {
        const keys = Object.keys(doc);
        addError(ctx, '',
            `Missing required top-level key 'logic'. Got keys: ${JSON.stringify(keys)}`,
            CODES.MISSING_LOGIC_KEY,
            "Every .ologic file must start with 'logic:' as the root key."
        );
        return true;
    }
    const extra = Object.keys(doc).filter(k => k !== 'logic');
    if (extra.length > 0) {
        addWarning(ctx, '',
            `Extra top-level keys (besides 'logic'): ${JSON.stringify(extra)}`,
            CODES.MISSING_LOGIC_KEY,
            "Only 'logic:' should be at the root level."
        );
    }
    return false;
}

/** @param {any} logic @param {Context} ctx @returns {string} mode */
function checkMode(logic, ctx) {
    if (!('mode' in logic)) {
        addError(ctx, 'logic', "Missing required field 'mode'",
            CODES.MISSING_MODE,
            `Must be one of: ${[...VALID_MODES].sort().join(', ')}`
        );
        return '';
    }
    const mode = logic.mode;
    if (typeof mode !== 'string') {
        addError(ctx, 'logic.mode', `'mode' must be a string, got ${typeof mode}`, CODES.INVALID_MODE);
        return '';
    }
    if (!VALID_MODES.has(mode)) {
        addError(ctx, 'logic.mode',
            `Invalid mode '${mode}'`,
            CODES.INVALID_MODE,
            `Valid modes: ${[...VALID_MODES].sort().join(', ')}`
        );
        return mode;
    }
    return mode;
}

/** @param {any} logic @param {Context} ctx @returns {string} version */
function checkVersion(logic, ctx) {
    if (!('version' in logic)) {
        addWarning(ctx, 'logic', "Missing recommended field 'version'",
            CODES.UNSUPPORTED_VERSION,
            "Add 'version: \"2.0\"' for forward compatibility."
        );
        return '';
    }
    const version = String(logic.version);
    if (!SUPPORTED_VERSIONS.has(version)) {
        addWarning(ctx, 'logic.version',
            `Unrecognized version '${version}'`,
            CODES.UNSUPPORTED_VERSION,
            `Supported versions: ${[...SUPPORTED_VERSIONS].sort().join(', ')}`
        );
    }
    return version;
}

/**
 * @param {any} logic
 * @param {Context} ctx
 * @returns {{ entryPoint: string, containers: any[] }}
 */
function checkEntryPoint(logic, ctx) {
    const hasNetworks = 'networks' in logic && logic.networks != null;
    const hasFactories = 'factories' in logic && logic.factories != null;
    const hasMachines = 'machines' in logic && logic.machines != null;
    const hasNodes = 'nodes' in logic && logic.nodes != null;

    const active = [];
    if (hasNetworks) active.push('networks');
    if (hasFactories) active.push('factories');
    if (hasMachines) active.push('machines');

    if (active.length === 0) {
        if (hasNodes) {
            addWarning(ctx, 'logic',
                "Top-level 'nodes' found without a machines/factories/networks wrapper.",
                CODES.NO_ENTRY_POINT,
                "Bare top-level nodes are unusual. Wrap them in a 'machines:' block."
            );
            return { entryPoint: 'machines', containers: [] };
        }
        addError(ctx, 'logic',
            "No entry point found. Must have one of: 'networks', 'factories', 'machines'.",
            CODES.NO_ENTRY_POINT,
            'Choose the lowest hierarchy level you need.'
        );
        return { entryPoint: '', containers: [] };
    }

    if (active.length > 1) {
        addError(ctx, 'logic',
            `Multiple entry points defined: ${JSON.stringify(active)}. Only one is allowed per file.`,
            CODES.MULTIPLE_ENTRY_POINTS,
            'Use exactly one of: networks, factories, machines.'
        );
    }

    const entryPoint = active[0];
    const containers = logic[entryPoint];
    if (!Array.isArray(containers)) {
        addError(ctx, `logic.${entryPoint}`,
            `'${entryPoint}' must be a list, got ${typeof containers}`,
            CODES.NO_ENTRY_POINT
        );
        return { entryPoint, containers: [] };
    }
    if (containers.length === 0) {
        addWarning(ctx, `logic.${entryPoint}`,
            `'${entryPoint}' list is empty — no content to render.`,
            CODES.EMPTY_CONTAINER
        );
    }
    return { entryPoint, containers };
}

// ── Pass 1: Hierarchy validators ───────────────────────────────────────────────

/**
 * @param {any[]} networks
 * @param {Context} ctx
 */
function validateNetworks(networks, ctx) {
    if (!Array.isArray(networks)) {
        addError(ctx, 'logic.networks', `'networks' must be a list, got ${typeof networks}`, CODES.EMPTY_CONTAINER);
        return;
    }
    ctx.counts.networks = networks.length;

    networks.forEach((net, i) => {
        const path = `logic.networks[${i}]`;
        if (!net || typeof net !== 'object' || Array.isArray(net)) {
            addError(ctx, path, `Network entry must be a mapping, got ${Array.isArray(net) ? 'array' : typeof net}`, CODES.MISSING_ID);
            return;
        }

        requireId(net, path, ctx);
        warnUnknownKeys(net, KNOWN_NETWORK_KEYS, path, ctx);
        validatePositionHint(net, path, ctx);

        if ('edges' in net) {
            addError(ctx, path,
                "'edges' is not a valid .ologic key. Use inputs/outputs on nodes to express connections.",
                CODES.INVALID_EDGES_KEY
            );
        }

        const hasFactories = 'factories' in net && Array.isArray(net.factories) && net.factories.length > 0;
        const hasMachines = 'machines' in net && Array.isArray(net.machines) && net.machines.length > 0;
        if (!hasFactories && !hasMachines) {
            addWarning(ctx, path,
                "Network has no 'factories' or 'machines' list.",
                CODES.EMPTY_CONTAINER,
                "A network should contain at least one factory or machine."
            );
        }

        if ('factories' in net && net.factories != null) {
            validateFactories(net.factories, ctx, `${path}.factories`, net.id ?? '');
        }
        if ('machines' in net && net.machines != null) {
            validateMachines(net.machines, ctx, `${path}.machines`, '');
        }
        if ('nodes' in net && net.nodes != null) {
            validateNodes(net.nodes, ctx, `${path}.nodes`, '');
        }
    });
}

/**
 * @param {any[]} factories
 * @param {Context} ctx
 * @param {string} path
 * @param {string} parentNetworkId
 */
function validateFactories(factories, ctx, path, parentNetworkId) {
    if (!Array.isArray(factories)) {
        addError(ctx, path, `'factories' must be a list, got ${typeof factories}`, CODES.EMPTY_CONTAINER);
        return;
    }
    ctx.counts.factories += factories.length;

    factories.forEach((factory, i) => {
        const fpath = `${path}[${i}]`;
        if (!factory || typeof factory !== 'object' || Array.isArray(factory)) {
            addError(ctx, fpath, `Factory entry must be a mapping, got ${Array.isArray(factory) ? 'array' : typeof factory}`, CODES.MISSING_ID);
            return;
        }

        requireId(factory, fpath, ctx);
        warnUnknownKeys(factory, KNOWN_FACTORY_KEYS, fpath, ctx);
        validatePositionHint(factory, fpath, ctx);

        const fid = factory.id ?? '?';

        if ('outputs' in factory) {
            addError(ctx, fpath,
                `Factory '${fid}' declares 'outputs', which is not allowed. Factories don't have outputs. Use nodes with outputs: [target-id] instead.`,
                CODES.CONTAINER_HAS_IO
            );
        }
        if ('inputs' in factory) {
            addError(ctx, fpath,
                `Factory '${fid}' declares 'inputs', which is not allowed. Factories don't have inputs. Use nodes with inputs: [source-id] instead.`,
                CODES.CONTAINER_HAS_IO
            );
        }
        if ('edges' in factory) {
            addError(ctx, fpath,
                "'edges' is not a valid .ologic key. Use inputs/outputs on nodes to express connections.",
                CODES.INVALID_EDGES_KEY
            );
        }

        if (!('machines' in factory) || factory.machines == null) {
            addWarning(ctx, fpath,
                "Factory has no 'machines' list.",
                CODES.EMPTY_CONTAINER,
                'A factory should contain at least one machine.'
            );
        } else {
            validateMachines(factory.machines, ctx, `${fpath}.machines`, fid);
        }

        if ('nodes' in factory && factory.nodes != null) {
            validateNodes(factory.nodes, ctx, `${fpath}.nodes`, '');
        }
    });
}

/**
 * @param {any[]} machines
 * @param {Context} ctx
 * @param {string} path
 * @param {string} parentFactoryId
 */
function validateMachines(machines, ctx, path, parentFactoryId) {
    if (!Array.isArray(machines)) {
        addError(ctx, path, `'machines' must be a list, got ${typeof machines}`, CODES.EMPTY_CONTAINER);
        return;
    }
    ctx.counts.machines += machines.length;

    machines.forEach((machine, i) => {
        const mpath = `${path}[${i}]`;
        if (!machine || typeof machine !== 'object' || Array.isArray(machine)) {
            addError(ctx, mpath, `Machine entry must be a mapping, got ${Array.isArray(machine) ? 'array' : typeof machine}`, CODES.MISSING_ID);
            return;
        }

        requireId(machine, mpath, ctx);
        warnUnknownKeys(machine, KNOWN_MACHINE_KEYS, mpath, ctx);
        validatePositionHint(machine, mpath, ctx);

        const mid = machine.id ?? '?';

        if ('outputs' in machine) {
            addError(ctx, mpath,
                `Machine '${mid}' declares 'outputs', which is not allowed. Machines don't have outputs. Set outputs: [target-node-id] on the last node instead.`,
                CODES.CONTAINER_HAS_IO
            );
        }
        if ('inputs' in machine) {
            addError(ctx, mpath,
                `Machine '${mid}' declares 'inputs', which is not allowed. Machines don't have inputs. Set inputs: [source-node-id] on the first node instead.`,
                CODES.CONTAINER_HAS_IO
            );
        }
        if ('edges' in machine) {
            addError(ctx, mpath,
                "'edges' is not a valid .ologic key. Use inputs/outputs on nodes to express connections.",
                CODES.INVALID_EDGES_KEY
            );
        }

        if (!('nodes' in machine) || machine.nodes == null) {
            addWarning(ctx, mpath,
                "Machine has no 'nodes' list.",
                CODES.EMPTY_CONTAINER,
                'A machine should contain at least one node.'
            );
        } else {
            validateNodes(machine.nodes, ctx, `${mpath}.nodes`, mid);
        }
    });
}

/**
 * @param {any[]} nodes
 * @param {Context} ctx
 * @param {string} path
 * @param {string} machineId  — empty string for factory-level or network-level bridge nodes
 */
function validateNodes(nodes, ctx, path, machineId) {
    if (!Array.isArray(nodes)) {
        addError(ctx, path, `'nodes' must be a list, got ${typeof nodes}`, CODES.EMPTY_CONTAINER);
        return;
    }
    ctx.counts.nodes += nodes.length;

    const validTypes = NODE_TYPES_BY_MODE[ctx.mode] ?? ALL_KNOWN_TYPES;

    nodes.forEach((node, i) => {
        const npath = `${path}[${i}]`;
        if (!node || typeof node !== 'object' || Array.isArray(node)) {
            addError(ctx, npath, `Node entry must be a mapping, got ${Array.isArray(node) ? 'array' : typeof node}`, CODES.MISSING_ID);
            return;
        }

        requireId(node, npath, ctx);

        // Register node→machine mapping for Pass 2
        if (machineId && typeof node.id === 'string' && node.id.trim()) {
            ctx.nodeToMachine.set(node.id, machineId);
        }

        // Type check
        checkNodeType(node, ctx, npath, validTypes);

        // Content/label/title
        if (!('content' in node) && !('label' in node) && !('title' in node)) {
            addWarning(ctx, npath,
                "Node has neither 'content', 'label', nor 'title'.",
                CODES.MISSING_NODE_TYPE,
                "Add 'title: \"...\"' or 'content: \"...\"' to describe this node."
            );
        }

        // inputs/outputs type check (cross-ref check is in Pass 2)
        checkIoList(node, 'inputs', npath, ctx);
        checkIoList(node, 'outputs', npath, ctx);

        // Reject connections/edges keys on nodes
        if ('connections' in node) {
            addError(ctx, npath,
                "'connections' is not a valid .ologic node key. Use 'outputs: [target-id]' or 'inputs: [source-id]' instead.",
                CODES.INVALID_EDGES_KEY
            );
        }
        if ('edges' in node) {
            addError(ctx, npath,
                "'edges' is not a valid .ologic key. Use inputs/outputs on nodes to express connections.",
                CODES.INVALID_EDGES_KEY
            );
        }

        // Coordinates
        for (const coord of ['x', 'y']) {
            if (coord in node && typeof node[coord] !== 'number') {
                addError(ctx, `${npath}.${coord}`,
                    `Coordinate '${coord}' must be a number, got ${typeof node[coord]}: ${JSON.stringify(node[coord])}`,
                    CODES.INVALID_NODE_TYPE
                );
            }
        }

        // Requirements
        if ('requirements' in node) {
            validateRequirements(node.requirements, `${npath}.requirements`, ctx);
        }

        warnUnknownKeys(node, KNOWN_NODE_KEYS, npath, ctx);
        validatePositionHint(node, npath, ctx);
    });
}

// ── Pass 1: Field-level validators ─────────────────────────────────────────────

/**
 * @param {any} obj
 * @param {string} path
 * @param {Context} ctx
 */
function requireId(obj, path, ctx) {
    if (!('id' in obj)) {
        addError(ctx, path,
            "Missing required field 'id'",
            CODES.MISSING_ID,
            'Every network/factory/machine/node must have a unique id.'
        );
    } else if (!obj.id || (typeof obj.id === 'string' && !obj.id.trim())) {
        addError(ctx, path, "'id' must not be empty.", CODES.EMPTY_ID);
    }
}

/**
 * @param {any} node
 * @param {Context} ctx
 * @param {string} path
 * @param {Set<string>} validTypes
 */
function checkNodeType(node, ctx, path, validTypes) {
    if (!('type' in node) && !('node_type' in node)) {
        addWarning(ctx, path,
            "Node has no 'type' or 'node_type' field — will render as 'default'.",
            CODES.MISSING_NODE_TYPE,
            `Valid types for mode '${ctx.mode}': ${[...validTypes].sort().join(', ')}`
        );
        return;
    }
    const nodeType = node.type ?? node.node_type;
    if (typeof nodeType !== 'string') {
        addError(ctx, `${path}.type`,
            `'type' must be a string, got ${typeof nodeType}: ${JSON.stringify(nodeType)}`,
            CODES.INVALID_NODE_TYPE
        );
        return;
    }
    if (!validTypes.has(nodeType)) {
        if (ALL_KNOWN_TYPES.has(nodeType)) {
            addWarning(ctx, `${path}.type`,
                `Node type '${nodeType}' is valid in another mode but not '${ctx.mode}'`,
                CODES.WRONG_MODE_NODE_TYPE,
                `Valid types for mode '${ctx.mode}': ${[...validTypes].sort().join(', ')}`
            );
        } else {
            addError(ctx, `${path}.type`,
                `Unknown node type '${nodeType}'`,
                CODES.INVALID_NODE_TYPE,
                `Valid types for mode '${ctx.mode}': ${[...validTypes].sort().join(', ')}`
            );
        }
    }
}

/**
 * Validate inputs or outputs array — type check only in Pass 1.
 * Cross-ref (unknown ID) check happens in Pass 2 after all IDs are collected.
 * @param {any} node
 * @param {'inputs'|'outputs'} field
 * @param {string} path
 * @param {Context} ctx
 */
function checkIoList(node, field, path, ctx) {
    if (!(field in node)) return;
    const val = node[field];
    if (val === null || val === undefined) {
        addWarning(ctx, `${path}.${field}`,
            `'${field}' is null — omit it or use an empty list [].`,
            CODES.INVALID_IO_TYPE
        );
        return;
    }
    if (!Array.isArray(val)) {
        addError(ctx, `${path}.${field}`,
            `'${field}' must be a list of ID strings, got ${typeof val}: ${JSON.stringify(val)}`,
            CODES.INVALID_IO_TYPE,
            `Example: ${field}: [other-node-id, machine-id]`
        );
        return;
    }
    val.forEach((ref, j) => {
        const rpath = `${path}.${field}[${j}]`;
        if (typeof ref !== 'string') {
            addError(ctx, rpath,
                `'${field}' entries must be strings (node/machine/factory IDs), got ${typeof ref}: ${JSON.stringify(ref)}`,
                CODES.INVALID_IO_TYPE,
                'Use the string ID of the node or container you are referencing.'
            );
        } else if (!ref.trim()) {
            addError(ctx, rpath, `'${field}' entry is an empty string.`, CODES.EMPTY_ID);
        }
        // Unknown ref check deferred to Pass 2
    });
}

/**
 * @param {any} reqs
 * @param {string} path
 * @param {Context} ctx
 */
function validateRequirements(reqs, path, ctx) {
    if (reqs === null || reqs === undefined) return;
    if (!Array.isArray(reqs)) {
        addError(ctx, path,
            `'requirements' must be a list of requirement ID strings, got ${typeof reqs}`,
            CODES.INVALID_NODE_TYPE
        );
        return;
    }
    reqs.forEach((reqId, i) => {
        const rpath = `${path}[${i}]`;
        if (typeof reqId !== 'string') {
            addError(ctx, rpath,
                `Requirement ID must be a string, got ${typeof reqId}: ${JSON.stringify(reqId)}`,
                CODES.INVALID_NODE_TYPE
            );
        } else if (!reqId.trim()) {
            addError(ctx, rpath, 'Requirement ID must not be empty.', CODES.EMPTY_ID);
        } else if (!REQ_PATTERN.test(reqId)) {
            addWarning(ctx, rpath,
                `Requirement ID '${reqId}' doesn't match expected pattern REQ-XX-NNN`,
                CODES.INVALID_NODE_TYPE,
                'Standard format: REQ-HA-001, REQ-ARCH-042, etc.'
            );
        }
    });
}

/**
 * @param {any} obj
 * @param {Set<string>} known
 * @param {string} path
 * @param {Context} ctx
 */
function warnUnknownKeys(obj, known, path, ctx) {
    const extras = Object.keys(obj).filter(k => !known.has(k));
    if (extras.length > 0) {
        addWarning(ctx, path,
            `Unexpected key(s): ${JSON.stringify(extras)}`,
            CODES.MISSING_NODE_TYPE,
            `Known keys here: ${[...known].sort().join(', ')}`
        );
    }
}

/**
 * Validate a position hint field on a container or node.
 * Format: "below <id>" | "above <id>" | "right-of <id>" | "left-of <id>"
 * Only validates format — anchor ID existence is NOT checked here (relational check).
 * @param {any} entity
 * @param {string} path
 * @param {Context} ctx
 */
function validatePositionHint(entity, path, ctx) {
    if (!('position' in entity)) return;
    const pos = entity.position;
    if (typeof pos !== 'string') {
        addError(ctx, `${path}.position`,
            `position must be a string, got ${typeof pos}`,
            CODES.INVALID_NODE_TYPE
        );
        return;
    }
    const match = pos.match(/^(below|above|right-of|left-of)\s+(\S+)$/);
    if (!match) {
        addError(ctx, `${path}.position`,
            `Invalid position format: "${pos}". Expected: "below <id>", "above <id>", "right-of <id>", or "left-of <id>"`,
            CODES.INVALID_NODE_TYPE
        );
    }
    // Anchor ID existence is a relational check — deferred or omitted intentionally.
}

// ── Pass 2: Relational checks ──────────────────────────────────────────────────

/**
 * Pass 2: Validate cross-references (inputs/outputs pointing to real IDs).
 * Runs over the entire logic subtree, checking any inputs/outputs arrays.
 * @param {any} logic
 * @param {Context} ctx
 */
function checkCrossRefs(logic, ctx) {
    function walkForIo(obj, path) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => walkForIo(item, `${path}[${i}]`));
            return;
        }
        // Check inputs/outputs on this object
        for (const field of ['inputs', 'outputs']) {
            const val = obj[field];
            if (!Array.isArray(val)) continue;
            val.forEach((ref, j) => {
                if (typeof ref !== 'string' || !ref.trim()) return; // Already reported in Pass 1
                if (!ctx.allIds.has(ref)) {
                    addWarning(ctx, `${path}.${field}[${j}]`,
                        `'${field}' references unknown ID '${ref}'`,
                        CODES.UNKNOWN_REF,
                        "This ID doesn't exist anywhere in the file. Check for typos."
                    );
                }
            });
        }
        // Recurse into child keys (skip id, inputs, outputs — already handled)
        for (const [key, value] of Object.entries(obj)) {
            if (key !== 'id' && key !== 'inputs' && key !== 'outputs') {
                walkForIo(value, `${path}.${key}`);
            }
        }
    }
    walkForIo(logic, 'logic');
}

/**
 * Pass 2: Detect cross-machine node edges.
 * A node in machine A must NEVER directly reference a node in machine B.
 * @param {any[]} machines
 * @param {Context} ctx
 * @param {string} contextPath
 */
function checkCrossMachineNodeEdges(machines, ctx, contextPath) {
    if (!Array.isArray(machines) || machines.length < 2) return;

    // Build nodeId → machineId map for THIS set of machines
    /** @type {Map<string, string>} */
    const nodeToMachine = new Map();
    /** @type {Map<string, Set<string>>} */
    const machineNodeSets = new Map();

    for (const machine of machines) {
        if (!machine || typeof machine !== 'object') continue;
        const mid = machine.id;
        if (!mid) continue;
        const nodeIds = new Set();
        for (const node of (machine.nodes ?? [])) {
            if (node && typeof node.id === 'string' && node.id.trim()) {
                nodeToMachine.set(node.id, mid);
                nodeIds.add(node.id);
            }
        }
        machineNodeSets.set(mid, nodeIds);
    }

    // Check every node's inputs/outputs for cross-machine node references
    for (const machine of machines) {
        if (!machine || typeof machine !== 'object') continue;
        const machineId = machine.id;
        if (!machineId) continue;
        const ownNodes = machineNodeSets.get(machineId) ?? new Set();

        for (const node of (machine.nodes ?? [])) {
            if (!node || typeof node !== 'object') continue;
            const nodeId = node.id;
            if (!nodeId) continue;

            for (const field of ['inputs', 'outputs']) {
                const refs = node[field];
                if (!Array.isArray(refs)) continue;
                for (const ref of refs) {
                    if (typeof ref !== 'string') continue;
                    if (ownNodes.has(ref)) continue;           // Same machine — fine
                    if (!nodeToMachine.has(ref)) continue;     // Not a known node — container ref, fine
                    const otherMachineId = nodeToMachine.get(ref);
                    if (otherMachineId === machineId) continue; // Same machine — fine

                    const hint = field === 'inputs'
                        ? `Use inputs: ['${otherMachineId}'] to reference the machine's input connector instead.`
                        : `Use outputs: ['${otherMachineId}'] to reference the machine's output connector instead.`;

                    addError(ctx, contextPath,
                        `Node '${nodeId}' in machine '${machineId}' has a direct edge to node '${ref}' in machine '${otherMachineId}'. Cross-machine connections must reference the machine ID, not individual nodes.`,
                        CODES.CROSS_MACHINE_NODE_EDGE,
                        hint
                    );
                }
            }
        }
    }
}

/**
 * Pass 2: Check factory connectivity.
 * A factory with multiple machines needs factory-level bridge nodes referencing machine IDs.
 * @param {any} factory
 * @param {Context} ctx
 * @param {string} fpath
 */
function checkFactoryConnectivity(factory, ctx, fpath) {
    const machines = factory.machines;
    if (!Array.isArray(machines) || machines.length === 0) return;

    const machineIds = new Set(
        machines
            .filter(m => m && typeof m === 'object' && m.id)
            .map(m => m.id)
    );
    if (machineIds.size === 0) return;

    const factoryNodes = Array.isArray(factory.nodes) ? factory.nodes : [];
    const connectedMachines = new Set();

    // Check factory-level bridge nodes that reference machine IDs
    for (const node of factoryNodes) {
        if (!node || typeof node !== 'object') continue;
        for (const ref of (node.inputs ?? [])) {
            if (typeof ref === 'string' && machineIds.has(ref)) connectedMachines.add(ref);
        }
        for (const ref of (node.outputs ?? [])) {
            if (typeof ref === 'string' && machineIds.has(ref)) connectedMachines.add(ref);
        }
    }

    // Also check nodes INSIDE machines that reference other machine IDs
    for (const machine of machines) {
        if (!machine || typeof machine !== 'object') continue;
        const machineId = machine.id;
        if (!machineId) continue;
        for (const node of (machine.nodes ?? [])) {
            if (!node || typeof node !== 'object') continue;
            for (const ref of (node.inputs ?? [])) {
                if (typeof ref === 'string' && machineIds.has(ref) && ref !== machineId) {
                    connectedMachines.add(ref);
                    connectedMachines.add(machineId);
                }
            }
            for (const ref of (node.outputs ?? [])) {
                if (typeof ref === 'string' && machineIds.has(ref) && ref !== machineId) {
                    connectedMachines.add(machineId);
                    connectedMachines.add(ref);
                }
            }
        }
    }

    if (factoryNodes.length === 0 && machines.length >= 2) {
        addWarning(ctx, fpath,
            `Factory '${factory.id ?? '?'}' has ${machines.length} machines but no standalone factory-level nodes to connect them.`,
            CODES.DISCONNECTED_MACHINES,
            "Per ontology rules, a factory is formed by a machine connecting to an external node. Add standalone nodes at factory level with inputs: [machine-id] to create proper container→node connections. If machines are independent, they should be separate factories."
        );
        return;
    }

    if (factoryNodes.length === 0 && machines.length === 1) {
        addInfo(ctx, fpath,
            `Factory '${factory.id ?? '?'}' has one machine and no standalone nodes — consider whether the factory wrapper is needed.`,
            CODES.UNNECESSARY_WRAPPER,
            'A factory is formed when a machine connects to an external node. A single machine without external nodes is just a machine.'
        );
        return;
    }

    // Check for disconnected machines
    const disconnected = [...machineIds].filter(mid => !connectedMachines.has(mid));
    if (disconnected.length > 0) {
        addWarning(ctx, fpath,
            `Factory '${factory.id ?? '?'}' has disconnected machine(s): ${JSON.stringify(disconnected.sort())}`,
            CODES.DISCONNECTED_MACHINES,
            "These machines are not referenced by any factory-level standalone node and have no cross-machine connections. Add a factory-level node with inputs: [machine-id] or outputs: [machine-id] to connect them, or move them to a separate factory."
        );
    }
}

/**
 * Pass 2: Check network connectivity.
 * Network-level bridge nodes must reference factory IDs or standalone machine IDs.
 * @param {any} network
 * @param {Context} ctx
 * @param {string} npath
 */
function checkNetworkConnectivity(network, ctx, npath) {
    const factories = Array.isArray(network.factories) ? network.factories : [];
    const networkMachines = Array.isArray(network.machines) ? network.machines : [];

    const factoryIds = new Set(
        factories
            .filter(f => f && typeof f === 'object' && f.id)
            .map(f => f.id)
    );

    // Standalone machines directly under the network
    const standaloneMachineIds = new Set(
        networkMachines
            .filter(m => m && typeof m === 'object' && m.id)
            .map(m => m.id)
    );

    const topLevelIds = new Set([...factoryIds, ...standaloneMachineIds]);
    if (topLevelIds.size === 0) return;

    const networkNodes = Array.isArray(network.nodes) ? network.nodes : [];
    const connectedContainers = new Set();

    for (const node of networkNodes) {
        if (!node || typeof node !== 'object') continue;
        for (const ref of (node.inputs ?? [])) {
            if (typeof ref === 'string' && topLevelIds.has(ref)) connectedContainers.add(ref);
        }
        for (const ref of (node.outputs ?? [])) {
            if (typeof ref === 'string' && topLevelIds.has(ref)) connectedContainers.add(ref);
        }
    }

    const containerCount = topLevelIds.size;

    if (networkNodes.length === 0 && containerCount >= 2) {
        addWarning(ctx, npath,
            `Network '${network.id ?? '?'}' has ${containerCount} containers (factories/machines) but no standalone network-level nodes to connect them.`,
            CODES.DISCONNECTED_FACTORIES,
            "Per ontology rules, a network is formed by a container (factory or machine) connecting to an external node. Add standalone nodes at network level with inputs: [factory-id] or inputs: [machine-id] to create proper connections. If containers are independent, they should be in separate networks."
        );
        return;
    }

    if (networkNodes.length === 0 && containerCount <= 1) {
        addInfo(ctx, npath,
            `Network '${network.id ?? '?'}' has ${containerCount} container(s) and no standalone nodes — consider whether the network wrapper is needed.`,
            CODES.UNNECESSARY_WRAPPER
        );
        return;
    }

    const disconnected = [...topLevelIds].filter(id => !connectedContainers.has(id));
    if (disconnected.length > 0) {
        addWarning(ctx, npath,
            `Network '${network.id ?? '?'}' has disconnected container(s): ${JSON.stringify(disconnected.sort())}`,
            CODES.DISCONNECTED_FACTORIES,
            "These factories/machines are not referenced by any network-level standalone node. Add a network-level node with inputs: [factory-id] or inputs: [machine-id] to connect them, or move them to a separate network."
        );
    }
}

/**
 * Walk the logic tree to run Pass 2 ontology checks.
 * @param {any} logic
 * @param {Context} ctx
 */
function runPass2OntologyChecks(logic, ctx) {
    // Networks level
    const networks = Array.isArray(logic.networks) ? logic.networks : [];
    networks.forEach((net, i) => {
        if (!net || typeof net !== 'object') return;
        const npath = `logic.networks[${i}]`;

        checkNetworkConnectivity(net, ctx, npath);

        const factories = Array.isArray(net.factories) ? net.factories : [];
        factories.forEach((factory, j) => {
            if (!factory || typeof factory !== 'object') return;
            const fpath = `${npath}.factories[${j}]`;
            const machines = Array.isArray(factory.machines) ? factory.machines : [];
            checkCrossMachineNodeEdges(machines, ctx, `${fpath}.machines`);
            checkFactoryConnectivity(factory, ctx, fpath);
        });

        // Standalone machines at network level
        const netMachines = Array.isArray(net.machines) ? net.machines : [];
        if (netMachines.length >= 2) {
            checkCrossMachineNodeEdges(netMachines, ctx, `${npath}.machines`);
        }
    });

    // Factories level (top-level entry point)
    const factories = Array.isArray(logic.factories) ? logic.factories : [];
    factories.forEach((factory, i) => {
        if (!factory || typeof factory !== 'object') return;
        const fpath = `logic.factories[${i}]`;
        const machines = Array.isArray(factory.machines) ? factory.machines : [];
        checkCrossMachineNodeEdges(machines, ctx, `${fpath}.machines`);
        checkFactoryConnectivity(factory, ctx, fpath);
    });

    // Machines level (top-level entry point)
    const machines = Array.isArray(logic.machines) ? logic.machines : [];
    if (machines.length >= 2) {
        checkCrossMachineNodeEdges(machines, ctx, 'logic.machines');
    }
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Validate a pre-parsed .ologic model object.
 *
 * @param {any} parsedData  — The result of parsing a .ologic YAML string. Must be a JS object.
 * @returns {{
 *   valid: boolean,
 *   errors: Issue[],
 *   warnings: Issue[],
 *   infos: Issue[],
 *   mode: string,
 *   version: string,
 *   entryPoint: string,
 *   counts: { nodes: number, machines: number, factories: number, networks: number },
 *   allIds: Set<string>,
 *   summary: string,
 * }}
 */
export function validateOlogic(parsedData) {
    const ctx = makeContext();

    // ── Fatal top-level check ──────────────────────────────────────────────────
    const fatal = checkTopLevel(parsedData, ctx);
    if (fatal) {
        return buildResult(ctx);
    }

    const logic = parsedData.logic;
    if (!logic || typeof logic !== 'object' || Array.isArray(logic)) {
        addError(ctx, 'logic', "'logic' must be a mapping (dict), not a scalar.", CODES.MISSING_LOGIC_KEY);
        return buildResult(ctx);
    }

    // ── Pass 1a: Collect all IDs (full tree scan for duplicate detection) ──────
    collectIds(logic, 'logic', ctx);

    // ── Pass 1b: Mode + Version ────────────────────────────────────────────────
    ctx.mode = checkMode(logic, ctx);
    ctx.version = checkVersion(logic, ctx);

    // ── Pass 1c: Entry point ───────────────────────────────────────────────────
    const { entryPoint } = checkEntryPoint(logic, ctx);
    ctx.entryPoint = entryPoint;

    // ── Pass 1d: Hierarchy walk ────────────────────────────────────────────────
    if (entryPoint === 'networks') {
        validateNetworks(logic.networks ?? [], ctx);
    } else if (entryPoint === 'factories') {
        validateFactories(logic.factories ?? [], ctx, 'logic.factories', '');
    } else if (entryPoint === 'machines') {
        validateMachines(logic.machines ?? [], ctx, 'logic.machines', '');
    }

    // ── Check for unexpected top-level keys under logic ────────────────────────
    const KNOWN_LOGIC_KEYS = new Set(['mode', 'version', 'networks', 'factories', 'machines', 'name', 'title', 'description', 'label', 'nodes']);
    warnUnknownKeys(logic, KNOWN_LOGIC_KEYS, 'logic', ctx);

    // ── Pass 2: Relational checks (only if no fatal structural errors) ─────────
    const hasStructuralErrors = ctx.errors.some(e =>
        e.code === CODES.MISSING_LOGIC_KEY ||
        e.code === CODES.NO_ENTRY_POINT ||
        e.code === CODES.MULTIPLE_ENTRY_POINTS
    );

    if (!hasStructuralErrors) {
        checkCrossRefs(logic, ctx);
        runPass2OntologyChecks(logic, ctx);
    }

    return buildResult(ctx);
}

/**
 * @param {Context} ctx
 */
function buildResult(ctx) {
    const valid = ctx.errors.length === 0;
    const { counts, mode, version, entryPoint, errors, warnings, infos } = ctx;
    const allIds = new Set(ctx.allIds.keys());

    const status = valid ? '✅ VALID' : '❌ INVALID';
    const parts = [
        status,
        `mode=${mode || '?'}`,
        `version=${version || '?'}`,
        `entry=${entryPoint || '?'}`,
        `nodes=${counts.nodes}`,
        `machines=${counts.machines}`,
    ];
    if (counts.factories > 0) parts.push(`factories=${counts.factories}`);
    if (counts.networks > 0) parts.push(`networks=${counts.networks}`);
    parts.push(`errors=${errors.length}`);
    if (warnings.length > 0) parts.push(`warnings=${warnings.length}`);

    const summary = parts.join('  ');

    return { valid, errors, warnings, infos, mode, version, entryPoint, counts, allIds, summary };
}

// ── Compatibility shim for clipboard.js ───────────────────────────────────────

/**
 * Drop-in replacement for the old `validateOlogicSyntax(parsed)` in clipboard.js.
 * Accepts a pre-parsed object and returns a flat string[] of error messages,
 * matching the legacy API exactly. Internally delegates to `validateOlogic()`.
 *
 * clipboard.js should import this instead of maintaining its own copy.
 *
 * @param {Record<string, any>} parsed - Parsed YAML object
 * @returns {string[]} Array of error message strings (empty = valid)
 */
export function validateOlogicSyntax(parsed) {
    // Bare .ologic format guard (legacy check from clipboard.js)
    if (parsed && parsed.mode && parsed.networks && !parsed.logic) {
        return [
            `Missing logic: wrapper. Got bare mode '${parsed.mode}' + networks at top level. ` +
            `Wrap in: logic: { mode: '${parsed.mode}', networks: [...] }`,
        ];
    }
    // Not an .ologic file (no logic: key) — skip validation
    if (!parsed || !parsed.logic) return [];

    const result = validateOlogic(parsed);
    // Convert structured Issue[] → flat string[] (errors only, matching legacy behavior)
    return result.errors.map(e => {
        const loc = e.path ? `[${e.path}] ` : '';
        const hint = e.hint ? `  → ${e.hint}` : '';
        return `${loc}${e.message}${hint}`;
    });
}

// ── Self-test (guarded) ────────────────────────────────────────────────────────

if (typeof globalThis !== 'undefined' && globalThis.__OLOGIC_VALIDATOR_TEST__) {
    console.log('\n=== OlogicValidator Self-Test ===\n');

    // ── Test 1: Valid knowledge model — 2 machines in a factory via bridge node ──
    const validModel = {
        logic: {
            mode: 'knowledge',
            version: '2.0',
            factories: [{
                id: 'analysis-factory',
                machines: [
                    {
                        id: 'input-machine',
                        nodes: [
                            { id: 'raw-text', type: 'input', title: 'Raw Text Input' },
                            { id: 'preprocessor', type: 'process', title: 'Preprocessor', inputs: ['raw-text'] },
                        ],
                    },
                    {
                        id: 'output-machine',
                        nodes: [
                            { id: 'ai-analyzer', type: 'ai', title: 'AI Analyzer' },
                            { id: 'final-output', type: 'output', title: 'Final Output', inputs: ['ai-analyzer'] },
                        ],
                    },
                ],
                nodes: [
                    {
                        id: 'factory-bridge',
                        type: 'process',
                        title: 'Factory Bridge',
                        inputs: ['input-machine'],
                        outputs: ['output-machine'],
                    },
                ],
            }],
        },
    };

    const r1 = validateOlogic(validModel);
    console.log('Test 1 — Valid knowledge model:');
    console.log('  Summary:', r1.summary);
    console.log('  Errors:', r1.errors.length, '| Warnings:', r1.warnings.length);
    if (r1.errors.length > 0) r1.errors.forEach(e => console.log('  ❌', e.message));
    console.assert(r1.valid === true, 'Test 1 FAILED: expected valid=true');
    console.assert(r1.counts.machines === 2, 'Test 1 FAILED: expected 2 machines');
    console.assert(r1.counts.factories === 1, 'Test 1 FAILED: expected 1 factory');
    console.log('  Result:', r1.valid ? '✅ PASS' : '❌ FAIL');

    // ── Test 2: Cross-machine node edge — should produce CROSS_MACHINE_NODE_EDGE ─
    const crossMachineModel = {
        logic: {
            mode: 'knowledge',
            version: '2.0',
            factories: [{
                id: 'bad-factory',
                machines: [
                    {
                        id: 'machine-a',
                        nodes: [
                            { id: 'node-a1', type: 'input', title: 'Input A' },
                            { id: 'node-a2', type: 'process', title: 'Process A', inputs: ['node-a1'] },
                        ],
                    },
                    {
                        id: 'machine-b',
                        nodes: [
                            // node-b1 references node-a2 (in machine-a) directly — INVALID
                            { id: 'node-b1', type: 'ai', title: 'AI B', inputs: ['node-a2'] },
                            { id: 'node-b2', type: 'output', title: 'Output B', inputs: ['node-b1'] },
                        ],
                    },
                ],
                nodes: [
                    { id: 'bridge', type: 'process', title: 'Bridge', inputs: ['machine-a'], outputs: ['machine-b'] },
                ],
            }],
        },
    };

    const r2 = validateOlogic(crossMachineModel);
    console.log('\nTest 2 — Cross-machine node edge:');
    console.log('  Summary:', r2.summary);
    const crossEdgeErrors = r2.errors.filter(e => e.code === 'CROSS_MACHINE_NODE_EDGE');
    console.log('  CROSS_MACHINE_NODE_EDGE errors:', crossEdgeErrors.length);
    crossEdgeErrors.forEach(e => console.log('  ❌', e.message));
    console.assert(crossEdgeErrors.length >= 1, 'Test 2 FAILED: expected CROSS_MACHINE_NODE_EDGE error');
    console.log('  Result:', crossEdgeErrors.length >= 1 ? '✅ PASS' : '❌ FAIL');

    // ── Test 3: Disconnected machines — should produce DISCONNECTED_MACHINES ─────
    const disconnectedModel = {
        logic: {
            mode: 'automation',
            version: '2.0',
            factories: [{
                id: 'sparse-factory',
                // Two machines, no factory-level nodes to connect them
                machines: [
                    {
                        id: 'worker-machine',
                        nodes: [
                            { id: 'trigger-node', type: 'trigger', title: 'Trigger' },
                            { id: 'worker-node', type: 'worker', title: 'Worker', inputs: ['trigger-node'] },
                        ],
                    },
                    {
                        id: 'output-machine',
                        nodes: [
                            { id: 'artifact-node', type: 'artifact', title: 'Artifact' },
                        ],
                    },
                ],
                // No factory.nodes array — no bridge nodes — machines are disconnected
            }],
        },
    };

    const r3 = validateOlogic(disconnectedModel);
    console.log('\nTest 3 — Disconnected machines:');
    console.log('  Summary:', r3.summary);
    const disconnectedWarnings = r3.warnings.filter(w => w.code === 'DISCONNECTED_MACHINES');
    console.log('  DISCONNECTED_MACHINES warnings:', disconnectedWarnings.length);
    disconnectedWarnings.forEach(w => console.log('  ⚠️', w.message));
    console.assert(disconnectedWarnings.length >= 1, 'Test 3 FAILED: expected DISCONNECTED_MACHINES warning');
    console.log('  Result:', disconnectedWarnings.length >= 1 ? '✅ PASS' : '❌ FAIL');

    console.log('\n=== Self-test complete ===\n');
}
