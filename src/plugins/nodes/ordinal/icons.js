/**
 * Ordinal SVG Icon Registry
 *
 * Ported from Canvas-MCP's icons.py (Pillow drawing primitives) to SVG paths.
 * Each icon is a function that returns an SVG string rendered into a 24x24 viewBox.
 * The `color` parameter sets the stroke/fill accent color.
 *
 * Icon Categories:
 *   Cloud       — cloud, aws, gcp, azure
 *   Compute     — server, vm, container, pod, lambda
 *   Networking  — loadbalancer, gateway, firewall, cdn, dns
 *   Storage     — database, objectstore, filesystem, cache
 *   Services    — api, queue, monitoring, logs, search
 *   Agent/AI    — brain, oracle, worker, bus
 *   General     — lock, key, globe, user, users, gear, bell, mail, network
 */

/**
 * @typedef {(color: string) => string} IconFn
 */

// ─── Cloud Icons ────────────────────────────────────────────────────────

/** @type {IconFn} */
function cloud(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6.5 19a4.5 4.5 0 0 1-.42-8.98A7 7 0 0 1 19.5 11a4.5 4.5 0 0 1 .5 8.97"
              stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;
}

/** @type {IconFn} */
function aws(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6.5 17a3.5 3.5 0 0 1-.35-6.98A5.5 5.5 0 0 1 16.5 10a3.5 3.5 0 0 1 .5 6.95"
              stroke="${color}" stroke-width="1.5" fill="none"/>
        <path d="M8 20h8M14 19l2 1" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
}

/** @type {IconFn} */
function gcp(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="12,3 21,7.5 21,16.5 12,21 3,16.5 3,7.5"
                 stroke="${color}" stroke-width="1.5" fill="none"/>
        <polygon points="12,7 17,9.5 17,14.5 12,17 7,14.5 7,9.5"
                 stroke="${color}" stroke-width="1.2" fill="none"/>
    </svg>`;
}

/** @type {IconFn} */
function azure(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="12,2 22,12 12,22 2,12" stroke="${color}" stroke-width="1.5" fill="none"/>
        <line x1="12" y1="7" x2="12" y2="17" stroke="${color}" stroke-width="1.2"/>
        <line x1="7" y1="12" x2="17" y2="12" stroke="${color}" stroke-width="1.2"/>
    </svg>`;
}

// ─── Compute Icons ──────────────────────────────────────────────────────

/** @type {IconFn} */
function server(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="2" width="16" height="6" rx="1.5" stroke="${color}" stroke-width="1.5"/>
        <rect x="4" y="10" width="16" height="6" rx="1.5" stroke="${color}" stroke-width="1.5"/>
        <circle cx="17" cy="5" r="1" fill="${color}"/>
        <circle cx="17" cy="13" r="1" fill="${color}"/>
        <line x1="8" y1="20" x2="16" y2="20" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="12" y1="16" x2="12" y2="20" stroke="${color}" stroke-width="1.5"/>
    </svg>`;
}

/** @type {IconFn} */
function vm(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="18" height="13" rx="2" stroke="${color}" stroke-width="1.5"/>
        <line x1="12" y1="16" x2="12" y2="20" stroke="${color}" stroke-width="1.5"/>
        <line x1="8" y1="20" x2="16" y2="20" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <polygon points="12,7 14.5,10 9.5,10" stroke="${color}" stroke-width="1" fill="none"/>
    </svg>`;
}

/** @type {IconFn} */
function containerIcon(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="6" width="16" height="13" rx="2" stroke="${color}" stroke-width="1.5"/>
        <line x1="4" y1="12" x2="20" y2="12" stroke="${color}" stroke-width="1"/>
        <line x1="9" y1="6" x2="9" y2="19" stroke="${color}" stroke-width="1"/>
        <line x1="15" y1="6" x2="15" y2="19" stroke="${color}" stroke-width="1"/>
        <path d="M9.5 3.5 Q12 1 14.5 3.5" stroke="${color}" stroke-width="1.5" fill="none"/>
    </svg>`;
}

/** @type {IconFn} */
function pod(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="${color}" stroke-width="1.5"/>
        <circle cx="12" cy="12" r="3.5" stroke="${color}" stroke-width="1.2" fill="none"/>
        ${[0,1,2,3,4,5,6].map(i => {
            const a = (360/7)*i - 90;
            const r1 = 3.5, r2 = 8;
            const rad = a * Math.PI / 180;
            return `<line x1="${12 + r1*Math.cos(rad)}" y1="${12 + r1*Math.sin(rad)}" x2="${12 + r2*Math.cos(rad)}" y2="${12 + r2*Math.sin(rad)}" stroke="${color}" stroke-width="1"/>`;
        }).join('')}
    </svg>`;
}

/** @type {IconFn} */
function lambda(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="7,20 12,4 17,20" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="5" y1="4" x2="13" y2="4" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
}

// ─── Networking Icons ───────────────────────────────────────────────────

/** @type {IconFn} */
function loadbalancer(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="5" cy="12" r="2.5" stroke="${color}" stroke-width="1.5"/>
        <circle cx="19" cy="5" r="2" stroke="${color}" stroke-width="1.2"/>
        <circle cx="19" cy="12" r="2" stroke="${color}" stroke-width="1.2"/>
        <circle cx="19" cy="19" r="2" stroke="${color}" stroke-width="1.2"/>
        <line x1="7.5" y1="12" x2="17" y2="5" stroke="${color}" stroke-width="1"/>
        <line x1="7.5" y1="12" x2="17" y2="12" stroke="${color}" stroke-width="1"/>
        <line x1="7.5" y1="12" x2="17" y2="19" stroke="${color}" stroke-width="1"/>
    </svg>`;
}

/** @type {IconFn} */
function gateway(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="5" width="4" height="14" rx="1" stroke="${color}" stroke-width="1.5"/>
        <rect x="17" y="5" width="4" height="14" rx="1" stroke="${color}" stroke-width="1.5"/>
        <path d="M3 5 Q12 0 21 5" stroke="${color}" stroke-width="1.5" fill="none"/>
        <line x1="7" y1="12" x2="17" y2="12" stroke="${color}" stroke-width="1.5"/>
        <polyline points="14,9 17,12 14,15" stroke="${color}" stroke-width="1.2" fill="none"/>
    </svg>`;
}

/** @type {IconFn} */
function firewall(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L3 7v6c0 5.25 3.83 9.82 9 11 5.17-1.18 9-5.75 9-11V7l-9-5z"
              stroke="${color}" stroke-width="1.5" fill="none"/>
        <line x1="6" y1="10" x2="18" y2="10" stroke="${color}" stroke-width="1"/>
        <line x1="6" y1="14" x2="18" y2="14" stroke="${color}" stroke-width="1"/>
        <line x1="12" y1="6" x2="12" y2="10" stroke="${color}" stroke-width="1"/>
        <line x1="9" y1="10" x2="9" y2="14" stroke="${color}" stroke-width="1"/>
        <line x1="15" y1="10" x2="15" y2="14" stroke="${color}" stroke-width="1"/>
    </svg>`;
}

/** @type {IconFn} */
function cdn(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="12" r="7" stroke="${color}" stroke-width="1.5"/>
        <ellipse cx="10" cy="12" rx="3" ry="7" stroke="${color}" stroke-width="1"/>
        <line x1="3" y1="12" x2="17" y2="12" stroke="${color}" stroke-width="1"/>
        <line x1="18" y1="8" x2="22" y2="8" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="18" y1="12" x2="22" y2="12" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="18" y1="16" x2="22" y2="16" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
}

/** @type {IconFn} */
function dns(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="3" width="16" height="18" rx="2" stroke="${color}" stroke-width="1.5"/>
        <line x1="7" y1="3" x2="7" y2="21" stroke="${color}" stroke-width="1.5"/>
        <line x1="10" y1="8" x2="17" y2="8" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
        <line x1="10" y1="12" x2="17" y2="12" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
        <line x1="10" y1="16" x2="17" y2="16" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
    </svg>`;
}

// ─── Storage Icons ──────────────────────────────────────────────────────

/** @type {IconFn} */
function database(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="12" cy="5" rx="8" ry="3" stroke="${color}" stroke-width="1.5"/>
        <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" stroke="${color}" stroke-width="1.5"/>
        <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" stroke="${color}" stroke-width="1"/>
    </svg>`;
}

/** @type {IconFn} */
function objectstore(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="5,5 19,5 17,19 7,19" stroke="${color}" stroke-width="1.5" fill="none"/>
        <path d="M9 2 Q12 0 15 2" stroke="${color}" stroke-width="1.5" fill="none"/>
        <circle cx="10" cy="11" r="1.5" stroke="${color}" stroke-width="1"/>
        <circle cx="14" cy="9" r="1.5" stroke="${color}" stroke-width="1"/>
        <circle cx="12" cy="15" r="1.5" stroke="${color}" stroke-width="1"/>
    </svg>`;
}

/** @type {IconFn} */
function filesystem(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 8V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" stroke="${color}" stroke-width="1.5"/>
        <path d="M4 8h5l2-3h3l-1 3h7" stroke="${color}" stroke-width="1.5" fill="none"/>
    </svg>`;
}

/** @type {IconFn} */
function cache(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="13,2 8,11 12,11 11,22 16,13 12,13"
                 stroke="${color}" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
    </svg>`;
}

// ─── Service Icons ──────────────────────────────────────────────────────

/** @type {IconFn} */
function api(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 4a4 4 0 0 0-4 4v0a4 4 0 0 0 4 4" stroke="${color}" stroke-width="1.5" fill="none"/>
        <path d="M8 20a4 4 0 0 1-4-4v0a4 4 0 0 1 4-4" stroke="${color}" stroke-width="1.5" fill="none"/>
        <path d="M16 4a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4" stroke="${color}" stroke-width="1.5" fill="none"/>
        <path d="M16 20a4 4 0 0 0 4-4v0a4 4 0 0 0-4-4" stroke="${color}" stroke-width="1.5" fill="none"/>
        <circle cx="12" cy="12" r="1.5" fill="${color}"/>
    </svg>`;
}

/** @type {IconFn} */
function queue(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="8" width="20" height="8" rx="4" stroke="${color}" stroke-width="1.5"/>
        <rect x="5" y="10" width="3" height="4" rx="0.5" stroke="${color}" stroke-width="1"/>
        <rect x="10" y="10" width="3" height="4" rx="0.5" stroke="${color}" stroke-width="1"/>
        <rect x="15" y="10" width="3" height="4" rx="0.5" stroke="${color}" stroke-width="1"/>
        <polyline points="20,9 22,12 20,15" stroke="${color}" stroke-width="1.2" fill="none"/>
    </svg>`;
}

/** @type {IconFn} */
function monitoring(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="18" height="15" rx="2" stroke="${color}" stroke-width="1.5"/>
        <polyline points="6,13 9,13 10.5,8 12,15 13.5,10 15,12 18,12"
                  stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

/** @type {IconFn} */
function logs(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="3" width="14" height="18" rx="2" stroke="${color}" stroke-width="1.5"/>
        <line x1="8" y1="7" x2="16" y2="7" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
        <line x1="8" y1="11" x2="16" y2="11" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
        <line x1="8" y1="15" x2="14" y2="15" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
        <line x1="8" y1="19" x2="12" y2="19" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
    </svg>`;
}

/** @type {IconFn} */
function search(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="7" stroke="${color}" stroke-width="1.5"/>
        <line x1="15" y1="15" x2="21" y2="21" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
}

// ─── Agent / AI Icons ───────────────────────────────────────────────────

/** @type {IconFn} */
function brain(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 4a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3.5 5.5V20h7v-3.5c2-1 3.5-3 3.5-5.5a7 7 0 0 0-7-7z"
              stroke="${color}" stroke-width="1.5" fill="none"/>
        <line x1="12" y1="6" x2="12" y2="16" stroke="${color}" stroke-width="1"/>
        <path d="M8.5 8 Q12 6 15.5 8" stroke="${color}" stroke-width="1" fill="none"/>
        <path d="M8.5 11 Q12 9 15.5 11" stroke="${color}" stroke-width="1" fill="none"/>
        <circle cx="9" cy="14" r="0.8" fill="${color}"/>
        <circle cx="15" cy="14" r="0.8" fill="${color}"/>
        <circle cx="12" cy="13" r="0.8" fill="${color}"/>
    </svg>`;
}

/** @type {IconFn} */
function oracle(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 12c3-6 7-8 10-8s7 2 10 8c-3 6-7 8-10 8s-7-2-10-8z"
              stroke="${color}" stroke-width="1.5" fill="none"/>
        <circle cx="12" cy="12" r="3.5" stroke="${color}" stroke-width="1.5"/>
        <circle cx="12" cy="12" r="1.5" fill="${color}"/>
    </svg>`;
}

/** @type {IconFn} */
function worker(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="5" stroke="${color}" stroke-width="1.5"/>
        <circle cx="12" cy="12" r="2" stroke="${color}" stroke-width="1"/>
        ${[0,1,2,3,4,5,6,7].map(i => {
            const a = 45 * i;
            const rad = a * Math.PI / 180;
            return `<line x1="${12 + 4.5*Math.cos(rad)}" y1="${12 + 4.5*Math.sin(rad)}" x2="${12 + 7*Math.cos(rad)}" y2="${12 + 7*Math.sin(rad)}" stroke="${color}" stroke-width="1.5"/>`;
        }).join('')}
    </svg>`;
}

/** @type {IconFn} */
function bus(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="3" y1="12" x2="21" y2="12" stroke="${color}" stroke-width="2.5"/>
        ${[-6,-2,2,6].map(off => {
            const x = 12 + off;
            return `<line x1="${x}" y1="6" x2="${x}" y2="12" stroke="${color}" stroke-width="1.5"/>
                    <line x1="${x}" y1="12" x2="${x}" y2="18" stroke="${color}" stroke-width="1.5"/>
                    <circle cx="${x}" cy="5.5" r="1.2" fill="${color}"/>
                    <circle cx="${x}" cy="18.5" r="1.2" fill="${color}"/>`;
        }).join('')}
    </svg>`;
}

// ─── General Icons ──────────────────────────────────────────────────────

/** @type {IconFn} */
function lock(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="11" width="14" height="10" rx="2" stroke="${color}" stroke-width="1.5"/>
        <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="${color}" stroke-width="1.5" fill="none"/>
        <circle cx="12" cy="15.5" r="1.2" fill="${color}"/>
        <line x1="12" y1="16.5" x2="12" y2="18.5" stroke="${color}" stroke-width="1.2"/>
    </svg>`;
}

/** @type {IconFn} */
function key(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="12" r="4" stroke="${color}" stroke-width="1.5"/>
        <line x1="12" y1="12" x2="21" y2="12" stroke="${color}" stroke-width="1.5"/>
        <line x1="17" y1="12" x2="17" y2="15" stroke="${color}" stroke-width="1.2"/>
        <line x1="19.5" y1="12" x2="19.5" y2="15" stroke="${color}" stroke-width="1.2"/>
    </svg>`;
}

/** @type {IconFn} */
function globe(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="${color}" stroke-width="1.5"/>
        <ellipse cx="12" cy="12" rx="3.5" ry="9" stroke="${color}" stroke-width="1"/>
        <line x1="3" y1="12" x2="21" y2="12" stroke="${color}" stroke-width="1"/>
        <path d="M4 8 Q12 5.5 20 8" stroke="${color}" stroke-width="1" fill="none"/>
        <path d="M4 16 Q12 18.5 20 16" stroke="${color}" stroke-width="1" fill="none"/>
    </svg>`;
}

/** @type {IconFn} */
function user(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="8" r="4" stroke="${color}" stroke-width="1.5"/>
        <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" stroke="${color}" stroke-width="1.5" fill="none"/>
    </svg>`;
}

/** @type {IconFn} */
function users(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="9" cy="8" r="3.5" stroke="${color}" stroke-width="1.5"/>
        <path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" stroke="${color}" stroke-width="1.5" fill="none"/>
        <circle cx="17" cy="7" r="2.5" stroke="${color}" stroke-width="1.2" opacity="0.7"/>
        <path d="M19 14c2 1 3.5 2.5 3.5 5" stroke="${color}" stroke-width="1.2" fill="none" opacity="0.7"/>
    </svg>`;
}

/** @type {IconFn} */
function gear(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="3" stroke="${color}" stroke-width="1.5"/>
        <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"
              stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
}

/** @type {IconFn} */
function bell(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 8c0-3.31-2.69-6-6-6S6 4.69 6 8c0 7-3 9-3 9h18s-3-2-3-9"
              stroke="${color}" stroke-width="1.5" fill="none"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="${color}" stroke-width="1.5"/>
    </svg>`;
}

/** @type {IconFn} */
function mail(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="${color}" stroke-width="1.5"/>
        <polyline points="3,5 12,13 21,5" stroke="${color}" stroke-width="1.5" fill="none"/>
    </svg>`;
}

/** @type {IconFn} */
function network(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="5" r="2.5" stroke="${color}" stroke-width="1.5"/>
        <circle cx="5" cy="18" r="2.5" stroke="${color}" stroke-width="1.5"/>
        <circle cx="19" cy="18" r="2.5" stroke="${color}" stroke-width="1.5"/>
        <line x1="12" y1="7.5" x2="5" y2="15.5" stroke="${color}" stroke-width="1.2"/>
        <line x1="12" y1="7.5" x2="19" y2="15.5" stroke="${color}" stroke-width="1.2"/>
        <line x1="7.5" y1="18" x2="16.5" y2="18" stroke="${color}" stroke-width="1.2"/>
        <circle cx="12" cy="13" r="1.2" fill="${color}"/>
    </svg>`;
}


// ─── Icon Registry (canonical names + aliases) ──────────────────────────

/** @type {Record<string, IconFn>} */
export const ICON_REGISTRY = {
    // Cloud
    'cloud':          cloud,
    'aws':            aws,
    'gcp':            gcp,
    'azure':          azure,

    // Compute
    'server':         server,
    'vm':             vm,
    'container':      containerIcon,
    'docker':         containerIcon,
    'pod':            pod,
    'k8s':            pod,
    'kubernetes':     pod,
    'lambda':         lambda,
    'serverless':     lambda,
    'function':       lambda,

    // Networking
    'loadbalancer':   loadbalancer,
    'lb':             loadbalancer,
    'gateway':        gateway,
    'firewall':       firewall,
    'cdn':            cdn,
    'dns':            dns,

    // Storage
    'database':       database,
    'db':             database,
    'objectstore':    objectstore,
    's3':             objectstore,
    'bucket':         objectstore,
    'filesystem':     filesystem,
    'folder':         filesystem,
    'cache':          cache,
    'redis':          cache,

    // Services
    'api':            api,
    'queue':          queue,
    'mq':             queue,
    'sqs':            queue,
    'kafka':          queue,
    'monitoring':     monitoring,
    'metrics':        monitoring,
    'grafana':        monitoring,
    'logs':           logs,
    'search':         search,

    // Agent / AI
    'brain':          brain,
    'ai':             brain,
    'oracle':         oracle,
    'eye':            oracle,
    'worker':         worker,
    'bus':            bus,

    // General
    'lock':           lock,
    'security':       lock,
    'key':            key,
    'globe':          globe,
    'internet':       globe,
    'web':            globe,
    'user':           user,
    'users':          users,
    'team':           users,
    'gear':           gear,
    'settings':       gear,
    'bell':           bell,
    'notification':   bell,
    'alert':          bell,
    'mail':           mail,
    'email':          mail,
    'network':        network,
    'topology':       network,
};

/**
 * Get an SVG icon string by name.
 * Returns null if the icon name is not found.
 *
 * @param {string} iconName
 * @param {string} color - Hex color for stroke/fill
 * @returns {string | null}
 */
export function getIcon(iconName, color) {
    const fn = ICON_REGISTRY[iconName.toLowerCase().trim()];
    if (!fn) return null;
    return fn(color);
}

/**
 * Get sorted list of all available icon names (including aliases).
 * @returns {string[]}
 */
export function getIconNames() {
    return Object.keys(ICON_REGISTRY).sort();
}

/**
 * Check if an icon name exists in the registry.
 * @param {string} name
 * @returns {boolean}
 */
export function hasIcon(name) {
    return name.toLowerCase().trim() in ICON_REGISTRY;
}
