/**
 * Generic deep merge utilities for Ordinal config merges.
 * - Objects: shallow keys merged recursively.
 * - Arrays: by default unchanged. To merge arrays, use mergeArrayByKey.
 */

/**
 * @template T
 * @param {T} target
 * @param {any} patch
 * @returns {T}
 */
export function deepMerge(target, patch) {
  if (patch === null || patch === undefined) return target;
  if (typeof target !== 'object' || target === null) return /** @type {any} */ (patch);
  if (typeof patch !== 'object' || Array.isArray(patch)) return /** @type {any} */ (patch);

  /** @type {any} */
  const out = Array.isArray(target) ? [...target] : { ...target };

  for (const [k, v] of Object.entries(patch)) {
    if (k === '$set') {
      // Replace whole object
      return /** @type {any} */ (v);
    }
    if (k === '$remove' && Array.isArray(v) && !Array.isArray(out)) {
      // Remove object keys
      v.forEach((key) => { try { delete out[/** @type {any} */(key)]; } catch {} });
      continue;
    }

    const curr = /** @type {any} */ (out)[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      /** @type {any} */
      const merged = deepMerge(curr, v);
      /** @type {any} */ (out)[k] = merged;
    } else {
      /** @type {any} */ (out)[k] = v;
    }
  }

  return /** @type {T} */ (out);
}

/**
 * Merge arrays by key with explicit directives.
 * @template T
 * @param {T[]} target
 * @param {{ $mergeBy: string, $upsert?: T[], $remove?: any[], $append?: T[] }} directives
 * @returns {T[]}
 */
export function mergeArrayByKey(target, directives) {
  if (!Array.isArray(target)) target = [];
  const key = directives.$mergeBy;
  /** @type {Map<any, T>} */
  const index = new Map();
  target.forEach((it) => {
    const id = /** @type {any} */ (it && /** @type {any} */(it)[key]);
    index.set(id, it);
  });

  // Remove
  if (Array.isArray(directives.$remove)) {
    directives.$remove.forEach((id) => {
      index.delete(id);
    });
  }

  // Upsert (merge when exists, append new)
  if (Array.isArray(directives.$upsert)) {
    directives.$upsert.forEach((item) => {
      const id = /** @type {any} */ (item && /** @type {any} */(item)[key]);
      if (index.has(id)) {
        const existing = index.get(id);
        /** @type {any} */
        const merged = deepMerge(existing, item);
        index.set(id, /** @type {T} */ (merged));
      } else {
        index.set(id, item);
      }
    });
  }

  /** @type {T[]} */
  let out = Array.from(index.values());
  if (Array.isArray(directives.$append) && directives.$append.length) {
    out = out.concat(directives.$append);
  }
  return out;
}
