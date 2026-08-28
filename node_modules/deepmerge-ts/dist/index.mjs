/**
 * Special values that tell deepmerge to perform a certain action.
 */
const actions = {
    defaultMerge: Symbol("deepmerge-ts: default merge"),
    skip: Symbol("deepmerge-ts: skip"),
};
/**
 * Special values that tell deepmergeInto to perform a certain action.
 */
const actionsInto = {
    defaultMerge: actions.defaultMerge,
};

/**
 * Returns an empty container of the same outward type as `value`. Used when
 * `deepmergeInto` recurses through a property the target does not have, so
 * the recursion has a place to write its result without aliasing any source's
 * nested array/set/map.
 *
 * @param value - A representative value (the kind to copy structurally).
 * @returns A fresh `Array` / `Set` / `Map` / `Record` (or `value` itself if it
 * is not one of those types).
 */
function emptyLike(value) {
    if (Array.isArray(value)) {
        return [];
    }
    if (value instanceof Set) {
        return new Set();
    }
    if (value instanceof Map) {
        return new Map();
    }
    if (typeof value === "object" && value !== null) {
        return {};
    }
    return value;
}
/**
 * The default function to update meta data.
 *
 * It builds and updates the hierarchy tree.
 *
 * @param previousMeta - The previous meta data.
 * @param mergeInfo - Meta information about the current merge state.
 * @returns The updated meta data.
 */
function defaultMetaDataUpdater(previousMeta, mergeInfo) {
    const ancestor = {
        key: mergeInfo.key,
        parents: mergeInfo.parents,
        values: mergeInfo.values,
        result: mergeInfo.result,
    };
    const prevHierarchy = previousMeta?.hierarchy;
    return {
        ...ancestor,
        hierarchy: prevHierarchy === undefined ? [ancestor] : [...prevHierarchy, ancestor],
    };
}
/**
 * The default function to update meta data in fast mode.
 *
 * It doesn't track any meta data.
 *
 * @param previousMeta - The previous meta data.
 * @param mergeInfo - Meta information about the current merge state.
 * @returns The updated meta data (undefined).
 */
function defaultMetaDataUpdaterFast(previousMeta, mergeInfo) {
    return undefined;
}
/**
 * The default function to filter values.
 *
 * It filters out undefined values.
 *
 * @param values - The values to filter.
 * @param meta - The meta data.
 * @returns The filtered values.
 */
function defaultFilterValues(values, meta) {
    // Fast path: avoid allocating a new array when no undefined values exist.
    return values.includes(undefined) ? values.filter((value) => value !== undefined) : values;
}
/**
 * Check if the custom merge result should fall back to the default merge function.
 *
 * @param utils - The utils.
 * @param fallback - The name of the fallback merge function.
 * @param result - The result of the custom merge function.
 * @returns Whether to use the default merge function.
 */
function shouldFallbackToDefault(utils, fallback, result) {
    return (result === actions.defaultMerge ||
        (utils.useImplicitDefaultMerging &&
            result === undefined &&
            utils.mergeFunctions[fallback] !== utils.defaultMergeFunctions[fallback]));
}
/**
 * Resolve custom merge functions from user options.
 *
 * @param options - The options passed by the user.
 * @param defaultMergeFunctions - The default merge functions.
 * @returns The resolved merge functions.
 */
function resolveCustomMergeFunctions(options, defaultMergeFunctions) {
    return {
        ...defaultMergeFunctions,
        ...Object.fromEntries(Object.entries(options)
            .filter(([key]) => Object.hasOwn(defaultMergeFunctions, key))
            .map(([key, option]) => option === false
            ? [key, defaultMergeFunctions.mergeOthers]
            : typeof option === "function"
                ? [key, option]
                : [key, defaultMergeFunctions[key]])),
    };
}
/**
 * The default strategy to merge arrays.
 *
 * @param values - The arrays.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged array.
 */
function mergeArrays$1(values, utils, meta) {
    return values.flat();
}
/**
 * The default strategy to merge sets.
 *
 * @param values - The sets.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged set.
 */
function mergeSets$1(values, utils, meta) {
    const result = new Set();
    for (const set of values) {
        for (const element of set) {
            result.add(element);
        }
    }
    return result;
}
/**
 * The default strategy to merge other things.
 *
 * @param values - The other things.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged value.
 */
function mergeOthers$1(values, utils, meta) {
    return values.at(-1);
}
/**
 * The default strategy to merge arrays into a target array.
 *
 * @param mut_target - The target to merge into.
 * @param values - The arrays (including the target's value if there is one).
 */
function mergeArraysInto$1(mut_target, values) {
    // Build the merged array.
    const result = [];
    for (const value of values) {
        const arr = value;
        for (const element of arr) {
            result.push(element);
        }
    }
    // Mutate the target container in place. At the top level this preserves
    // the user's target reference; in the recursion `mut_target.value` is
    // either the user's target's nested array (so the same in-place semantic
    // applies) or a clone we made ourselves, so the source can never be
    // touched through this assignment.
    const target = mut_target.value;
    target.splice(0, target.length, ...result);
}
/**
 * The default strategy to merge sets into a target set.
 *
 * @param mut_target - The target to merge into.
 * @param values - The sets (including the target's value if there is one).
 */
function mergeSetsInto$1(mut_target, values) {
    // Build the merged set.
    const result = new Set();
    for (const value_ of values) {
        for (const value of value_) {
            result.add(value);
        }
    }
    // Mutate the target set in place. See `mergeArraysInto` for the rationale
    // about why this is safe at recursion (the recursion only runs against
    // the target's nested container or a clone we made, never a source).
    const target = mut_target.value;
    target.clear();
    for (const value of result) {
        target.add(value);
    }
}
/**
 * The default strategy to merge other things into a target.
 *
 * @param mut_target - The target to merge into.
 * @param values - The other things.
 */
function mergeOthersInto$1(mut_target, values) {
    // Idempotent for non-containers: assigning the leaf value mutates only
    // the wrapper's `.value` slot (a property on our own object), so this is
    // safe at recursion regardless of where the wrapper originated.
    mut_target.value = values.at(-1);
}

/**
 * The different types of objects deepmerge-ts support.
 */
var ObjectType;
(function (ObjectType) {
    ObjectType[ObjectType["NOT"] = 0] = "NOT";
    ObjectType[ObjectType["RECORD"] = 1] = "RECORD";
    ObjectType[ObjectType["ARRAY"] = 2] = "ARRAY";
    ObjectType[ObjectType["SET"] = 3] = "SET";
    ObjectType[ObjectType["MAP"] = 4] = "MAP";
    ObjectType[ObjectType["OTHER"] = 5] = "OTHER";
})(ObjectType || (ObjectType = {}));
/**
 * Get the type of the given object.
 *
 * @param object - The object to get the type of.
 * @returns The type of the given object.
 */
function getObjectType(object) {
    if (typeof object !== "object" || object === null) {
        return ObjectType.NOT;
    }
    if (Array.isArray(object)) {
        return ObjectType.ARRAY;
    }
    if (isRecord(object)) {
        return ObjectType.RECORD;
    }
    if (object instanceof Set) {
        return ObjectType.SET;
    }
    if (object instanceof Map) {
        return ObjectType.MAP;
    }
    return ObjectType.OTHER;
}
/**
 * Get the keys of the given object(s) including symbol keys.
 * If an array is given, the keys of all the objects within the array are returned.
 *
 * Note: Only keys to enumerable properties are returned.
 *
 * @deprecated Use `getKeysOfObjects` instead.
 * @param objects - An array of objects to get the keys of.
 * @returns A set containing all the keys of all the given objects.
 */
const getKeys = getKeysOfObjects;
/**
 * Get the keys of the given objects including symbol keys.
 *
 * Note: Only keys to enumerable properties are returned.
 *
 * @param objects - An array of objects to get the keys of.
 * @returns A set containing all the keys of all the given objects.
 */
function getKeysOfObjects(objects) {
    const keys = new Set();
    for (const currentObject of objects) {
        const stringKeys = Object.keys(currentObject);
        for (const stringKey of stringKeys) {
            keys.add(stringKey);
        }
        const symbols = Object.getOwnPropertySymbols(currentObject);
        // Fast path: skip symbol iteration when the object has no own symbols.
        if (symbols.length > 0) {
            for (const symbol of symbols) {
                if (Object.prototype.propertyIsEnumerable.call(currentObject, symbol)) {
                    keys.add(symbol);
                }
            }
        }
    }
    return keys;
}
/**
 * Get the keys of the given object.
 *
 * Note: Only keys to enumerable properties are returned.
 *
 * @param object - The object to get the keys of.
 * @returns The keys of the given object.
 */
function getKeysOfObject(object) {
    const symbols = Object.getOwnPropertySymbols(object).filter((symbol) => Object.prototype.propertyIsEnumerable.call(object, symbol));
    return [...Object.keys(object), ...symbols];
}
/**
 * Does the given object have the given property.
 *
 * @param object - The object to test.
 * @param property - The property to test.
 * @returns Whether the object has the property.
 */
function objectHasProperty(object, property) {
    return typeof object === "object" && Object.prototype.propertyIsEnumerable.call(object, property);
}
/**
 * Does the given object appear to be a record.
 *
 * @param value - The object to check.
 * @returns Whether the object is a record.
 */
function isRecord(value) {
    // Fast path: Objects created via `{}` (whose prototype is `Object.prototype`)
    // or `Object.create(null)` (whose prototype is `null`) are plain records.
    // Assumes that standard plain objects do not have modified prototypes.
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null || prototype === Object.prototype) {
        return true;
    }
    // All records are objects.
    const objectToString = Object.prototype.toString.call(value);
    if (objectToString !== "[object Object]" && objectToString !== "[object Module]") {
        return false;
    }
    const { constructor } = value;
    // If has modified constructor.
    // eslint-disable-next-line ts/no-unnecessary-condition
    if (constructor === undefined) {
        return true;
    }
    const constructorPrototype = constructor.prototype;
    // If has modified prototype.
    if (constructorPrototype === null || typeof constructorPrototype !== "object") {
        return false;
    }
    const constructorToString = Object.prototype.toString.call(constructorPrototype);
    if (constructorToString !== "[object Object]" && constructorToString !== "[object Module]") {
        return false;
    }
    // If constructor does not have an Object-specific method.
    if (!Object.hasOwn(constructorPrototype, "isPrototypeOf")) {
        return false;
    }
    // Most likely a record.
    return true;
}
/**
 * If the given object is a cyclic reference in its ancestor tree, return how far down the ancestor tree the object is from its first occurrence. Otherwise, return 0.
 *
 * @param object - The object to check.
 * @param hierarchy - The hierarchy of the object.
 * @param index - The index of the object (or ancestor of) within the original values passed to the merge function.
 * @returns The cyclic reference depth of the object if it is a cyclic reference, or 0 if it is not.
 */
function getCyclicReferenceDepth(object, hierarchy, index) {
    // If there is no hierarchy, then there can be no cyclic reference.
    if (hierarchy === undefined || hierarchy.length === 0) {
        return 0;
    }
    let mut_depth = 1;
    // Check if the child is an ancestor of itself.
    for (let mut_index = hierarchy.length - 1; mut_index >= 0; mut_index--) {
        const { parents } = hierarchy[mut_index];
        if (parents[index] === object || parents.includes(object)) {
            return mut_depth;
        }
        mut_depth += 1;
    }
    return 0;
}
/**
 * Get the hierarchy array from the given meta data if present.
 *
 * @param meta - The meta data.
 * @returns The hierarchy array or undefined.
 */
function getMetaDataHierarchy(meta) {
    return meta?.hierarchy;
}

/**
 * The default strategy to merge records.
 *
 * @param values - The records.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged records.
 */
function mergeRecords$1(values, utils, meta) {
    if (values.length === 2) {
        const result = {};
        // Fast path for 2 records: avoid building a union key set and per-key value
        // arrays. Only the keys present in each record are iterated.
        const mergeProperty = (key, propValues) => {
            const updatedMeta = utils.metaDataUpdater(meta, {
                key,
                parents: values,
                values: propValues,
                result,
            });
            const propertyResult = mergeUnknowns(propValues, utils, updatedMeta);
            if (propertyResult === actions.skip) {
                return;
            }
            if (key === "__proto__") {
                Object.defineProperty(result, key, {
                    value: propertyResult,
                    configurable: true,
                    enumerable: true,
                    writable: true,
                });
            }
            else {
                result[key] = propertyResult;
            }
        };
        const firstValue = values[0];
        const secondValue = values[1];
        for (const key of getKeysOfObject(firstValue)) {
            mergeProperty(key, objectHasProperty(secondValue, key) ? [firstValue[key], secondValue[key]] : [firstValue[key]]);
        }
        for (const key of getKeysOfObject(secondValue)) {
            if (!objectHasProperty(firstValue, key)) {
                mergeProperty(key, [secondValue[key]]);
            }
        }
        return result;
    }
    return mergeRecordsGeneral(values, utils, meta);
}
/**
 * The default strategy to merge 3 or more records.
 *
 * @param values - The records.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged records.
 */
function mergeRecordsGeneral(values, utils, meta) {
    const result = {};
    for (const key of getKeysOfObjects(values)) {
        const propValues = [];
        for (const value of values) {
            if (objectHasProperty(value, key)) {
                propValues.push(value[key]);
            }
        }
        const updatedMeta = utils.metaDataUpdater(meta, {
            key,
            parents: values,
            values: propValues,
            result,
        });
        const propertyResult = mergeUnknowns(propValues, utils, updatedMeta);
        if (propertyResult === actions.skip) {
            continue;
        }
        if (key === "__proto__") {
            Object.defineProperty(result, key, {
                value: propertyResult,
                configurable: true,
                enumerable: true,
                writable: true,
            });
        }
        else {
            result[key] = propertyResult;
        }
    }
    return result;
}
/**
 * The default strategy to merge maps.
 *
 * @param values - The maps.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged map.
 */
function mergeMaps$1(values, utils, meta) {
    const result = new Map();
    const valuesByKey = new Map();
    for (const map of values) {
        for (const [key, value] of map) {
            const mut_keyValues = valuesByKey.get(key);
            if (mut_keyValues === undefined) {
                valuesByKey.set(key, [value]);
            }
            else {
                mut_keyValues.push(value);
            }
        }
    }
    for (const [key, keyValues] of valuesByKey) {
        const updatedMeta = utils.metaDataUpdater(meta, {
            key,
            parents: values,
            values: keyValues,
            result,
        });
        const keyResult = mergeUnknowns(keyValues, utils, updatedMeta);
        if (keyResult === actions.skip) {
            continue;
        }
        result.set(key, keyResult);
    }
    return result;
}
/**
 * Resolve any cyclic references within a non-cyclic object pointing to ancestors in meta.hierarchy.
 *
 * @param value - The value to resolve circular references for.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The resolved value.
 */
function resolveCyclicReferences(value, utils, meta) {
    if (typeof value !== "object" || value === null) {
        return value;
    }
    const hierarchy = getMetaDataHierarchy(meta);
    const depth = getCyclicReferenceDepth(value, hierarchy, 0);
    if (hierarchy !== undefined && depth > 0) {
        return hierarchy[hierarchy.length - depth]?.result;
    }
    const type = getObjectType(value);
    if (type === ObjectType.RECORD) {
        const record = value;
        let mut_changed = false;
        const result = {};
        for (const key of getKeysOfObject(record)) {
            const propVal = record[key];
            const updatedMeta = utils.metaDataUpdater(meta, {
                key,
                parents: [record],
                values: [propVal],
                result,
            });
            const resolvedProp = resolveCyclicReferences(propVal, utils, updatedMeta);
            if (resolvedProp !== propVal) {
                mut_changed = true;
            }
            if (key === "__proto__") {
                Object.defineProperty(result, key, {
                    value: resolvedProp,
                    configurable: true,
                    enumerable: true,
                    writable: true,
                });
            }
            else {
                result[key] = resolvedProp;
            }
        }
        return mut_changed ? result : value;
    }
    return value;
}
/**
 * The default strategy to merge circular references.
 *
 * @param values - The circular references.
 * @param cyclicDepths - The depth of each circular reference.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged circular references.
 */
function mergeCircularReferences$1(values, cyclicDepths, utils, meta) {
    const depth = cyclicDepths[0];
    const hierarchy = getMetaDataHierarchy(meta);
    for (let mut_index = 1; mut_index < values.length; mut_index++) {
        if (cyclicDepths[mut_index] !== depth) {
            const lastCyclicDepth = cyclicDepths.at(-1);
            return (lastCyclicDepth === 0
                ? resolveCyclicReferences(values.at(-1), utils, meta)
                : hierarchy?.[hierarchy.length - lastCyclicDepth]?.result);
        }
    }
    return hierarchy?.[hierarchy.length - depth]?.result;
}
/**
 * The merge functions.
 */
const mergeFunctions = {
    mergeRecords: mergeRecords$1,
    mergeArrays: mergeArrays$1,
    mergeSets: mergeSets$1,
    mergeMaps: mergeMaps$1,
    mergeCircularReferences: mergeCircularReferences$1,
    mergeOthers: mergeOthers$1,
};

const defaultDeepmerge = /* #__PURE__ */ deepmergeCustom();
/**
 * Deeply merge objects.
 *
 * @param objects - The objects to merge.
 * @returns The merged result.
 */
function deepmerge(...objects) {
    return defaultDeepmerge(...objects);
}
function deepmergeCustom(options = {}, rootMetaData) {
    const utils = getUtils$1(options, customizedDeepmerge);
    /**
     * The customized deepmerge function.
     *
     * @param objects - The objects to merge.
     * @returns The merged result.
     */
    function customizedDeepmerge(...objects) {
        return mergeUnknowns(objects, utils, rootMetaData ?? undefined);
    }
    return customizedDeepmerge;
}
/**
 * Get the utils that are available to the merge functions.
 *
 * @param options - The options the user specified.
 * @param customizedDeepmerge - The customized deepmerge function.
 * @returns The merge utils.
 */
function getUtils$1(options, customizedDeepmerge) {
    const defaultMergeFns = mergeFunctions;
    const defaultMetaDataUpd = defaultMetaDataUpdater;
    return {
        defaultMergeFunctions: defaultMergeFns,
        mergeFunctions: resolveCustomMergeFunctions(options, defaultMergeFns),
        metaDataUpdater: typeof options.metaDataUpdater === "function" ? options.metaDataUpdater : defaultMetaDataUpd,
        deepmerge: customizedDeepmerge,
        useImplicitDefaultMerging: options.enableImplicitDefaultMerging ?? false,
        filterValues: options.filterValues === false
            ? undefined
            : typeof options.filterValues === "function"
                ? options.filterValues
                : defaultFilterValues,
        maxDepth: typeof options.maxDepth === "number" && !Number.isNaN(options.maxDepth) && options.maxDepth >= 0
            ? options.maxDepth
            : 1000,
        actions,
    };
}
/**
 * Merge unknown things.
 *
 * @param values - The values.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged result.
 */
function mergeUnknowns(values, utils, meta) {
    const filteredValues = utils.filterValues?.(values, meta) ?? values;
    if (filteredValues.length === 0) {
        return undefined;
    }
    const hierarchy = getMetaDataHierarchy(meta);
    const currentDepth = hierarchy?.length ?? (typeof meta === "number" ? meta : (meta?.depth ?? 0));
    if (utils.maxDepth !== undefined && currentDepth >= utils.maxDepth) {
        return mergeOthers(filteredValues, utils, meta);
    }
    if (filteredValues.length === 1) {
        if (hierarchy !== undefined) {
            const depth = getCyclicReferenceDepth(filteredValues[0], hierarchy, 0);
            if (depth > 0) {
                return (hierarchy[hierarchy.length - depth]?.result ??
                    hierarchy[hierarchy.length - depth]?.parents[0]);
            }
        }
        return mergeOthers(filteredValues, utils, meta);
    }
    const type = getObjectType(filteredValues[0]);
    if (type !== ObjectType.NOT && type !== ObjectType.OTHER) {
        if (filteredValues.length === 2) {
            // Fast path: avoid dynamic array allocations and loop overhead for 2 elements.
            if (getObjectType(filteredValues[1]) !== type) {
                return mergeOthers(filteredValues, utils, meta);
            }
            const d0 = getCyclicReferenceDepth(filteredValues[0], hierarchy, 0);
            const d1 = getCyclicReferenceDepth(filteredValues[1], hierarchy, 1);
            if (d0 !== 0 || d1 !== 0) {
                return mergeCircularReferences(filteredValues, [d0, d1], utils, meta);
            }
        }
        else {
            // Slow path: 3 or more elements require dynamic array allocations and full iteration.
            // eslint-disable-next-line unicorn/no-new-array -- We know the final length of the array.
            const cyclicDepths = new Array(filteredValues.length);
            cyclicDepths[0] = getCyclicReferenceDepth(filteredValues[0], hierarchy, 0);
            for (let mut_index = 1; mut_index < filteredValues.length; mut_index++) {
                // If the object types are different, then we can't merge them.
                if (getObjectType(filteredValues[mut_index]) !== type) {
                    return mergeOthers(filteredValues, utils, meta);
                }
                // Check if the object is a cyclic reference.
                cyclicDepths[mut_index] = getCyclicReferenceDepth(filteredValues[mut_index], hierarchy, mut_index);
            }
            if (cyclicDepths.some((depth) => depth !== 0)) {
                return mergeCircularReferences(filteredValues, cyclicDepths, utils, meta);
            }
        }
    }
    switch (type) {
        case ObjectType.RECORD: {
            return mergeRecords(filteredValues, utils, meta);
        }
        case ObjectType.ARRAY: {
            return mergeArrays(filteredValues, utils, meta);
        }
        case ObjectType.SET: {
            return mergeSets(filteredValues, utils, meta);
        }
        case ObjectType.MAP: {
            return mergeMaps(filteredValues, utils, meta);
        }
        default: {
            return mergeOthers(filteredValues, utils, meta);
        }
    }
}
/**
 * Merge records.
 *
 * @param values - The records.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged result.
 */
function mergeRecords(values, utils, meta) {
    const result = utils.mergeFunctions.mergeRecords(values, utils, meta);
    if (shouldFallbackToDefault(utils, "mergeRecords", result)) {
        return utils.defaultMergeFunctions.mergeRecords(values, utils, meta);
    }
    return result;
}
/**
 * Merge arrays.
 *
 * @param values - The arrays.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged result.
 */
function mergeArrays(values, utils, meta) {
    const result = utils.mergeFunctions.mergeArrays(values, utils, meta);
    if (shouldFallbackToDefault(utils, "mergeArrays", result)) {
        return utils.defaultMergeFunctions.mergeArrays(values);
    }
    return result;
}
/**
 * Merge sets.
 *
 * @param values - The sets.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged result.
 */
function mergeSets(values, utils, meta) {
    const result = utils.mergeFunctions.mergeSets(values, utils, meta);
    if (shouldFallbackToDefault(utils, "mergeSets", result)) {
        return utils.defaultMergeFunctions.mergeSets(values);
    }
    return result;
}
/**
 * Merge maps.
 *
 * @param values - The maps.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged result.
 */
function mergeMaps(values, utils, meta) {
    const result = utils.mergeFunctions.mergeMaps(values, utils, meta);
    if (shouldFallbackToDefault(utils, "mergeMaps", result)) {
        return utils.defaultMergeFunctions.mergeMaps(values, utils, meta);
    }
    return result;
}
/**
 * Merge circular references.
 *
 * @param values - The circular references.
 * @param cyclicDepths - The depth of each circular reference.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged result.
 */
function mergeCircularReferences(values, cyclicDepths, utils, meta) {
    const result = utils.mergeFunctions.mergeCircularReferences(values, cyclicDepths, utils, meta);
    if (shouldFallbackToDefault(utils, "mergeCircularReferences", result)) {
        return utils.defaultMergeFunctions.mergeCircularReferences(values, cyclicDepths, utils, meta);
    }
    return result;
}
/**
 * Merge other things.
 *
 * @param values - The other things.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The merged result.
 */
function mergeOthers(values, utils, meta) {
    const result = utils.mergeFunctions.mergeOthers(values, utils, meta);
    if (shouldFallbackToDefault(utils, "mergeOthers", result)) {
        return utils.defaultMergeFunctions.mergeOthers(values);
    }
    return result;
}

/**
 * The fast default strategy to merge records without circular reference checks or depth limits.
 *
 * Assumes input is trusted and non-circular.
 *
 * @param values - The records.
 * @param utils - The utils.
 * @returns The merged records.
 */
function mergeRecordsFast$1(values, utils) {
    if (values.length === 2) {
        const result = {};
        // Fast path for 2 records: avoid building a union key set and per-key value
        // arrays. Only the keys present in each record are iterated.
        const mergeProperty = (key, propValues) => {
            const propertyResult = mergeUnknownsFast(propValues, utils);
            if (propertyResult === actions.skip) {
                return;
            }
            result[key] = propertyResult;
        };
        const firstValue = values[0];
        const secondValue = values[1];
        for (const key of getKeysOfObject(firstValue)) {
            mergeProperty(key, objectHasProperty(secondValue, key) ? [firstValue[key], secondValue[key]] : [firstValue[key]]);
        }
        for (const key of getKeysOfObject(secondValue)) {
            if (!objectHasProperty(firstValue, key)) {
                mergeProperty(key, [secondValue[key]]);
            }
        }
        return result;
    }
    return mergeRecordsFastGeneral(values, utils);
}
/**
 * The fast default strategy to merge 3 or more records without circular reference checks or depth limits.
 *
 * Assumes input is trusted and non-circular.
 *
 * @param values - The records.
 * @param utils - The utils.
 * @returns The merged records.
 */
function mergeRecordsFastGeneral(values, utils) {
    const result = {};
    for (const key of getKeysOfObjects(values)) {
        const propValues = [];
        for (const value of values) {
            if (objectHasProperty(value, key)) {
                propValues.push(value[key]);
            }
        }
        const propertyResult = mergeUnknownsFast(propValues, utils);
        if (propertyResult === actions.skip) {
            continue;
        }
        result[key] = propertyResult;
    }
    return result;
}
/**
 * The fast default strategy to merge maps without circular reference checks or depth limits.
 *
 * Assumes input is trusted and non-circular.
 *
 * @param values - The maps.
 * @param utils - The utils.
 * @returns The merged map.
 */
function mergeMapsFast$1(values, utils) {
    const result = new Map();
    const valuesByKey = new Map();
    for (const map of values) {
        for (const [key, value] of map) {
            const mut_keyValues = valuesByKey.get(key);
            if (mut_keyValues === undefined) {
                valuesByKey.set(key, [value]);
            }
            else {
                mut_keyValues.push(value);
            }
        }
    }
    for (const [key, keyValues] of valuesByKey) {
        const keyResult = mergeUnknownsFast(keyValues, utils);
        if (keyResult === actions.skip) {
            continue;
        }
        result.set(key, keyResult);
    }
    return result;
}
/**
 * The fast merge functions without circular reference checks.
 */
const mergeFunctionsFast = {
    mergeRecords: mergeRecordsFast$1,
    mergeArrays: mergeArrays$1,
    mergeSets: mergeSets$1,
    mergeMaps: mergeMapsFast$1,
    mergeOthers: mergeOthers$1,
};

const defaultDeepmergeFastUnsafe = /* #__PURE__ */ deepmergeFastUnsafeCustom();
/**
 * Deeply merge objects using a high-performance strategy.
 *
 * Differences from `deepmerge` (standard version):
 * - **No circular reference detection:** Does not track object hierarchies or detect cyclic references. Circular structures will result in a stack overflow.
 * - **No recursion depth limits:** Does not enforce a `maxDepth` limit (standard version defaults to 1000).
 * - **No metadata tracking:** Metadata updates and custom metadata tracking are bypassed, avoiding metadata object allocations.
 * - **No prototype pollution interception:** Assumes trusted data and directly assigns properties.
 *
 * @warning Only use this function with **trusted, non-circular data**.
 * Using this function with untrusted user data can result in serious security vulnerabilities:
 * - **Prototype pollution:** Prototype pollution safeguards are omitted for speed; malicious keys like `__proto__` can pollute object prototypes.
 * - **Denial of Service (DoS):** Circular reference detection and recursion depth limits are disabled; cyclic or deeply nested input will cause infinite recursion and crash via stack overflow.
 * @param objects - The objects to merge.
 * @returns The merged result.
 */
function deepmergeFastUnsafe(...objects) {
    return defaultDeepmergeFastUnsafe(...objects);
}
function deepmergeFastUnsafeCustom(options = {}) {
    const utils = getUtilsFast$1(options, customizedDeepmergeFast);
    function customizedDeepmergeFast(...objects) {
        return mergeUnknownsFast(objects, utils);
    }
    return customizedDeepmergeFast;
}
/**
 * Get the utils that are available to the merge functions in fast mode.
 *
 * @param options - The options the user specified.
 * @param customizedDeepmergeFast - The customized deepmergeFastUnsafe function.
 * @returns The fast merge utils.
 */
function getUtilsFast$1(options, customizedDeepmergeFast) {
    const defaultMergeFns = mergeFunctionsFast;
    const defaultMetaDataUpd = defaultMetaDataUpdaterFast;
    return {
        defaultMergeFunctions: defaultMergeFns,
        mergeFunctions: resolveCustomMergeFunctions(options, defaultMergeFns),
        metaDataUpdater: defaultMetaDataUpd,
        deepmerge: customizedDeepmergeFast,
        useImplicitDefaultMerging: options.enableImplicitDefaultMerging ?? false,
        filterValues: options.filterValues === false
            ? undefined
            : typeof options.filterValues === "function"
                ? options.filterValues
                : defaultFilterValues,
        maxDepth: undefined,
        actions,
    };
}
/**
 * Merge unknown things in fast mode without checking for circular references or depth limits.
 *
 * @param values - The values.
 * @param utils - The utils.
 * @returns The merged result.
 */
function mergeUnknownsFast(values, utils) {
    const filteredValues = utils.filterValues?.(values, undefined) ?? values;
    if (filteredValues.length === 0) {
        return undefined;
    }
    if (filteredValues.length === 1) {
        return mergeOthersFast(filteredValues, utils);
    }
    const type = getObjectType(filteredValues[0]);
    if (type !== ObjectType.NOT && type !== ObjectType.OTHER) {
        if (filteredValues.length === 2) {
            // Fast path: avoid loop overhead for 2 elements.
            if (getObjectType(filteredValues[1]) !== type) {
                return mergeOthersFast(filteredValues, utils);
            }
        }
        else {
            // Slow path: 3 or more elements require full iteration.
            for (let mut_index = 1; mut_index < filteredValues.length; mut_index++) {
                if (getObjectType(filteredValues[mut_index]) !== type) {
                    return mergeOthersFast(filteredValues, utils);
                }
            }
        }
    }
    switch (type) {
        case ObjectType.RECORD: {
            return mergeRecordsFast(filteredValues, utils);
        }
        case ObjectType.ARRAY: {
            return mergeArraysFast(filteredValues, utils);
        }
        case ObjectType.SET: {
            return mergeSetsFast(filteredValues, utils);
        }
        case ObjectType.MAP: {
            return mergeMapsFast(filteredValues, utils);
        }
        default: {
            return mergeOthersFast(filteredValues, utils);
        }
    }
}
/**
 * Merge records in fast mode.
 *
 * @param values - The records.
 * @param utils - The utils.
 * @returns The merged result.
 */
function mergeRecordsFast(values, utils) {
    const result = utils.mergeFunctions.mergeRecords(values, utils, undefined);
    if (shouldFallbackToDefault(utils, "mergeRecords", result)) {
        return utils.defaultMergeFunctions.mergeRecords(values, utils, undefined);
    }
    return result;
}
/**
 * Merge arrays in fast mode.
 *
 * @param values - The arrays.
 * @param utils - The utils.
 * @returns The merged result.
 */
function mergeArraysFast(values, utils) {
    const result = utils.mergeFunctions.mergeArrays(values, utils, undefined);
    if (shouldFallbackToDefault(utils, "mergeArrays", result)) {
        return utils.defaultMergeFunctions.mergeArrays(values);
    }
    return result;
}
/**
 * Merge sets in fast mode.
 *
 * @param values - The sets.
 * @param utils - The utils.
 * @returns The merged result.
 */
function mergeSetsFast(values, utils) {
    const result = utils.mergeFunctions.mergeSets(values, utils, undefined);
    if (shouldFallbackToDefault(utils, "mergeSets", result)) {
        return utils.defaultMergeFunctions.mergeSets(values);
    }
    return result;
}
/**
 * Merge maps in fast mode.
 *
 * @param values - The maps.
 * @param utils - The utils.
 * @returns The merged result.
 */
function mergeMapsFast(values, utils) {
    const result = utils.mergeFunctions.mergeMaps(values, utils, undefined);
    if (shouldFallbackToDefault(utils, "mergeMaps", result)) {
        return utils.defaultMergeFunctions.mergeMaps(values, utils, undefined);
    }
    return result;
}
/**
 * Merge other things in fast mode.
 *
 * @param values - The other things.
 * @param utils - The utils.
 * @returns The merged result.
 */
function mergeOthersFast(values, utils) {
    const result = utils.mergeFunctions.mergeOthers(values, utils, undefined);
    if (shouldFallbackToDefault(utils, "mergeOthers", result)) {
        return utils.defaultMergeFunctions.mergeOthers(values);
    }
    return result;
}

/**
 * The default strategy to merge records into a target record.
 *
 * @param mut_target - The target to merge into.
 * @param values - The records (including the target's value if there is one).
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeRecordsInto$1(mut_target, values, utils, meta) {
    if (values.length === 2) {
        // Fast path for 2 records: avoid building a union key set and per-key value
        // arrays. Only the keys present in each record are iterated.
        const mergeProperty = (key, propValues) => {
            const updatedMeta = utils.metaDataUpdater(meta, {
                key,
                parents: values,
                values: propValues,
                result: mut_target.value,
            });
            const propertyTarget = objectHasProperty(mut_target.value, key)
                ? { value: propValues[0] }
                : { value: emptyLike(propValues[0]) };
            mergeUnknownsInto(propertyTarget, propValues, utils, updatedMeta);
            if (key === "__proto__") {
                Object.defineProperty(mut_target.value, key, {
                    value: propertyTarget.value,
                    configurable: true,
                    enumerable: true,
                    writable: true,
                });
            }
            else {
                mut_target.value[key] = propertyTarget.value;
            }
        };
        const firstValue = values[0];
        const secondValue = values[1];
        for (const key of getKeysOfObject(firstValue)) {
            mergeProperty(key, objectHasProperty(secondValue, key) ? [firstValue[key], secondValue[key]] : [firstValue[key]]);
        }
        for (const key of getKeysOfObject(secondValue)) {
            if (!objectHasProperty(firstValue, key)) {
                mergeProperty(key, [secondValue[key]]);
            }
        }
        return;
    }
    mergeRecordsIntoGeneral(mut_target, values, utils, meta);
}
/**
 * The default strategy to merge 3 or more records into a target record.
 *
 * @param mut_target - The target to merge into.
 * @param values - The records (including the target's value if there is one).
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeRecordsIntoGeneral(mut_target, values, utils, meta) {
    for (const key of getKeysOfObjects(values)) {
        const propValues = [];
        for (const value of values) {
            if (objectHasProperty(value, key)) {
                propValues.push(value[key]);
            }
        }
        const updatedMeta = utils.metaDataUpdater(meta, {
            key,
            parents: values,
            values: propValues,
            result: mut_target.value,
        });
        const propertyTarget = objectHasProperty(mut_target.value, key)
            ? { value: propValues[0] }
            : { value: emptyLike(propValues[0]) };
        mergeUnknownsInto(propertyTarget, propValues, utils, updatedMeta);
        if (key === "__proto__") {
            Object.defineProperty(mut_target.value, key, {
                value: propertyTarget.value,
                configurable: true,
                enumerable: true,
                writable: true,
            });
        }
        else {
            mut_target.value[key] = propertyTarget.value;
        }
    }
}
/**
 * The default strategy to merge maps into a target map.
 *
 * @param mut_target - The target to merge into.
 * @param values - The maps (including the target's value if there is one).
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeMapsInto$1(mut_target, values, utils, meta) {
    // Merge into `mut_target.value` in place. The recursion branch never
    // aliases a source's container: `mergeUnknownsInto` below only operates on
    // the target's nested value (when target had the key) or on an empty
    // container we made (when target didn't have the key), so mutating this
    // map's contents cannot leak into a source.
    const valuesByKey = new Map();
    for (const value of values) {
        if (value === mut_target.value) {
            // `values` includes the target's own map when the recursion target
            // already had the key; its entries are merged via `target.get(key)`.
            continue;
        }
        for (const [key, entryValue] of value) {
            const mut_keyValues = valuesByKey.get(key);
            if (mut_keyValues === undefined) {
                valuesByKey.set(key, [entryValue]);
            }
            else {
                mut_keyValues.push(entryValue);
            }
        }
    }
    const target = mut_target.value;
    for (const [key, keyValues] of valuesByKey) {
        const targetValue = target.get(key);
        const allValues = targetValue === undefined ? keyValues : [targetValue, ...keyValues];
        // The `result` reported to metaDataUpdater must be `mut_target.value` so
        // that the hierarchy captures a stable reference to the target. Input
        // cycles that point back at the target then resolve correctly.
        const updatedMeta = utils.metaDataUpdater(meta, {
            key,
            parents: values,
            values: allValues,
            result: mut_target.value,
        });
        const propTarget = targetValue === undefined ? { value: emptyLike(allValues[0]) } : { value: targetValue };
        mergeUnknownsInto(propTarget, allValues, utils, updatedMeta);
        target.set(key, propTarget.value);
    }
}
/**
 * Resolve any cyclic references within a non-cyclic object pointing to ancestors in meta.hierarchy.
 *
 * @param value - The value to resolve circular references for.
 * @param utils - The utils.
 * @param meta - The meta data.
 * @returns The resolved value.
 */
function resolveCyclicReferencesInto(value, utils, meta) {
    if (typeof value !== "object" || value === null) {
        return value;
    }
    const hierarchy = getMetaDataHierarchy(meta);
    const depth = getCyclicReferenceDepth(value, hierarchy, 0);
    if (hierarchy !== undefined && depth > 0) {
        return hierarchy[hierarchy.length - depth]?.result ?? hierarchy[hierarchy.length - depth]?.parents[0];
    }
    const type = getObjectType(value);
    if (type === ObjectType.RECORD) {
        const record = value;
        let mut_changed = false;
        const result = {};
        for (const key of getKeysOfObject(record)) {
            const propVal = record[key];
            const updatedMeta = utils.metaDataUpdater(meta, {
                key,
                parents: [record],
                values: [propVal],
                result,
            });
            const resolvedProp = resolveCyclicReferencesInto(propVal, utils, updatedMeta);
            if (resolvedProp !== propVal) {
                mut_changed = true;
            }
            if (key === "__proto__") {
                Object.defineProperty(result, key, {
                    value: resolvedProp,
                    configurable: true,
                    enumerable: true,
                    writable: true,
                });
            }
            else {
                result[key] = resolvedProp;
            }
        }
        return mut_changed ? result : value;
    }
    return value;
}
/**
 * The default strategy to merge circular references into a target.
 *
 * @param mut_target - The target to merge into.
 * @param values - The circular references.
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeCircularReferencesInto$1(mut_target, values, utils, meta) {
    const hierarchy = getMetaDataHierarchy(meta);
    const cyclicDepths = values.map((v, i) => getCyclicReferenceDepth(v, hierarchy, i));
    const depth = cyclicDepths[0];
    for (let mut_index = 1; mut_index < values.length; mut_index++) {
        if (cyclicDepths[mut_index] !== depth) {
            const lastCyclicDepth = cyclicDepths.at(-1);
            mut_target.value =
                lastCyclicDepth === 0
                    ? resolveCyclicReferencesInto(values.at(-1), utils, meta)
                    : (hierarchy?.[hierarchy.length - lastCyclicDepth]?.result ??
                        hierarchy?.[hierarchy.length - lastCyclicDepth]?.parents[0]);
            return;
        }
    }
    mut_target.value = hierarchy?.[hierarchy.length - depth]?.result ?? hierarchy?.[hierarchy.length - depth]?.parents[0];
}
/**
 * The merge functions.
 */
const mergeIntoFunctions = {
    mergeRecords: mergeRecordsInto$1,
    mergeArrays: mergeArraysInto$1,
    mergeSets: mergeSetsInto$1,
    mergeMaps: mergeMapsInto$1,
    mergeCircularReferences: mergeCircularReferencesInto$1,
    mergeOthers: mergeOthersInto$1,
};

const defaultDeepmergeInto = /* #__PURE__ */ deepmergeIntoCustom();
function deepmergeInto(target, ...objects) {
    return void defaultDeepmergeInto(target, ...objects);
}
function deepmergeIntoCustom(options = {}, rootMetaData) {
    const utils = getUtils(options, customizedDeepmergeInto);
    /**
     * The customized deepmergeInto function.
     *
     * @param target - The target object to merge into.
     * @param objects - The objects to merge into the target.
     */
    function customizedDeepmergeInto(target, ...objects) {
        mergeUnknownsInto({ value: target }, [target, ...objects], utils, rootMetaData);
    }
    return customizedDeepmergeInto;
}
/**
 * Get the utils that are available to the merge functions.
 *
 * @param options - The options the user specified.
 * @param customizedDeepmergeInto - The customized deepmergeInto function.
 * @returns The merge into utils.
 */
function getUtils(options, customizedDeepmergeInto) {
    const defaultMergeFns = mergeIntoFunctions;
    const defaultMetaDataUpd = defaultMetaDataUpdater;
    return {
        defaultMergeFunctions: defaultMergeFns,
        mergeFunctions: resolveCustomMergeFunctions(options, defaultMergeFns),
        metaDataUpdater: typeof options.metaDataUpdater === "function" ? options.metaDataUpdater : defaultMetaDataUpd,
        deepmergeInto: customizedDeepmergeInto,
        filterValues: options.filterValues === false
            ? undefined
            : typeof options.filterValues === "function"
                ? options.filterValues
                : defaultFilterValues,
        maxDepth: typeof options.maxDepth === "number" && !Number.isNaN(options.maxDepth) && options.maxDepth >= 0
            ? options.maxDepth
            : 1000,
        actions: actionsInto,
    };
}
/**
 * Merge unknown things into a target.
 *
 * @param mut_target - The target to merge into.
 * @param values - The values.
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeUnknownsInto(mut_target, values, utils, meta) {
    const filteredValues = utils.filterValues?.(values, meta) ?? values;
    if (filteredValues.length === 0) {
        return;
    }
    const hierarchy = getMetaDataHierarchy(meta);
    const currentDepth = hierarchy?.length ?? (typeof meta === "number" ? meta : (meta?.depth ?? 0));
    if (utils.maxDepth !== undefined && currentDepth >= utils.maxDepth) {
        return void mergeOthersInto(mut_target, filteredValues, utils, meta);
    }
    if (filteredValues.length === 1) {
        if (hierarchy !== undefined) {
            const depth = getCyclicReferenceDepth(filteredValues[0], hierarchy, 0);
            if (depth > 0) {
                mut_target.value =
                    hierarchy[hierarchy.length - depth]?.result ?? hierarchy[hierarchy.length - depth]?.parents[0];
                return;
            }
        }
        return void mergeOthersInto(mut_target, filteredValues, utils, meta);
    }
    const type = getObjectType(mut_target.value);
    if (type !== ObjectType.NOT && type !== ObjectType.OTHER) {
        if (filteredValues.length === 2) {
            // Fast path: avoid dynamic array allocations and loop overhead for 2 elements.
            if (getObjectType(filteredValues[1]) !== type) {
                return void mergeOthersInto(mut_target, filteredValues, utils, meta);
            }
            const d0 = getCyclicReferenceDepth(filteredValues[0], hierarchy, 0);
            const d1 = getCyclicReferenceDepth(filteredValues[1], hierarchy, 1);
            if (d0 !== 0 || d1 !== 0) {
                return void mergeCircularReferencesInto(mut_target, filteredValues, utils, meta);
            }
        }
        else {
            // Slow path: 3 or more elements require dynamic array allocations and full iteration.
            // eslint-disable-next-line unicorn/no-new-array -- We know the final length of the array.
            const cyclicDepths = new Array(filteredValues.length);
            cyclicDepths[0] = getCyclicReferenceDepth(filteredValues[0], hierarchy, 0);
            for (let mut_index = 1; mut_index < filteredValues.length; mut_index++) {
                if (getObjectType(filteredValues[mut_index]) !== type) {
                    return void mergeOthersInto(mut_target, filteredValues, utils, meta);
                }
                cyclicDepths[mut_index] = getCyclicReferenceDepth(filteredValues[mut_index], hierarchy, mut_index);
            }
            if (cyclicDepths.some((depth) => depth !== 0)) {
                return void mergeCircularReferencesInto(mut_target, filteredValues, utils, meta);
            }
        }
    }
    switch (type) {
        case ObjectType.RECORD: {
            return void mergeRecordsInto(mut_target, filteredValues, utils, meta);
        }
        case ObjectType.ARRAY: {
            return void mergeArraysInto(mut_target, filteredValues, utils, meta);
        }
        case ObjectType.SET: {
            return void mergeSetsInto(mut_target, filteredValues, utils, meta);
        }
        case ObjectType.MAP: {
            return void mergeMapsInto(mut_target, filteredValues, utils, meta);
        }
        default: {
            return void mergeOthersInto(mut_target, filteredValues, utils, meta);
        }
    }
}
/**
 * Merge records into a target record.
 *
 * @param mut_target - The target to merge into.
 * @param values - The records.
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeRecordsInto(mut_target, values, utils, meta) {
    const action = utils.mergeFunctions.mergeRecords(mut_target, values, utils, meta);
    if (action === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeRecords(mut_target, values, utils, meta);
    }
}
/**
 * Merge arrays into a target array.
 *
 * @param mut_target - The target to merge into.
 * @param values - The arrays.
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeArraysInto(mut_target, values, utils, meta) {
    const action = utils.mergeFunctions.mergeArrays(mut_target, values, utils, meta);
    if (action === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeArrays(mut_target, values);
    }
}
/**
 * Merge sets into a target set.
 *
 * @param mut_target - The target to merge into.
 * @param values - The sets.
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeSetsInto(mut_target, values, utils, meta) {
    const action = utils.mergeFunctions.mergeSets(mut_target, values, utils, meta);
    if (action === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeSets(mut_target, values);
    }
}
/**
 * Merge maps into a target map.
 *
 * @param mut_target - The target to merge into.
 * @param values - The maps.
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeMapsInto(mut_target, values, utils, meta) {
    const action = utils.mergeFunctions.mergeMaps(mut_target, values, utils, meta);
    if (action === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeMaps(mut_target, values, utils, meta);
    }
}
/**
 * Merge circular references into a target.
 *
 * @param mut_target - The target to merge into.
 * @param values - The circular references.
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeCircularReferencesInto(mut_target, values, utils, meta) {
    const action = utils.mergeFunctions.mergeCircularReferences(mut_target, values, utils, meta);
    if (action === actionsInto.defaultMerge || mut_target.value === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeCircularReferences(mut_target, values, utils, meta);
    }
}
/**
 * Merge other things into a target.
 *
 * @param mut_target - The target to merge into.
 * @param values - The other things.
 * @param utils - The utils.
 * @param meta - The meta data.
 */
function mergeOthersInto(mut_target, values, utils, meta) {
    const action = utils.mergeFunctions.mergeOthers(mut_target, values, utils, meta);
    if (action === actionsInto.defaultMerge || mut_target.value === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeOthers(mut_target, values);
    }
}

/**
 * The fast default strategy to merge records into a target record without circular reference checks or depth limits.
 *
 * Assumes input is trusted and non-circular.
 *
 * @param mut_target - The target to merge into.
 * @param values - The records (including the target's value if there is one).
 * @param utils - The utils.
 */
function mergeRecordsIntoFast$1(mut_target, values, utils) {
    if (values.length === 2) {
        // Fast path for 2 records: avoid building a union key set and per-key value
        // arrays. Only the keys present in each record are iterated.
        const mergeProperty = (key, propValues) => {
            const propertyTarget = objectHasProperty(mut_target.value, key)
                ? { value: propValues[0] }
                : { value: emptyLike(propValues[0]) };
            mergeUnknownsIntoFast(propertyTarget, propValues, utils);
            mut_target.value[key] = propertyTarget.value;
        };
        const firstValue = values[0];
        const secondValue = values[1];
        for (const key of getKeysOfObject(firstValue)) {
            mergeProperty(key, objectHasProperty(secondValue, key) ? [firstValue[key], secondValue[key]] : [firstValue[key]]);
        }
        for (const key of getKeysOfObject(secondValue)) {
            if (!objectHasProperty(firstValue, key)) {
                mergeProperty(key, [secondValue[key]]);
            }
        }
        return;
    }
    mergeRecordsIntoFastGeneral(mut_target, values, utils);
}
/**
 * The fast default strategy to merge 3 or more records into a target record without circular reference checks or depth limits.
 *
 * Assumes input is trusted and non-circular.
 *
 * @param mut_target - The target to merge into.
 * @param values - The records (including the target's value if there is one).
 * @param utils - The utils.
 */
function mergeRecordsIntoFastGeneral(mut_target, values, utils) {
    for (const key of getKeysOfObjects(values)) {
        const propValues = [];
        for (const value of values) {
            if (objectHasProperty(value, key)) {
                propValues.push(value[key]);
            }
        }
        const propertyTarget = objectHasProperty(mut_target.value, key)
            ? { value: propValues[0] }
            : { value: emptyLike(propValues[0]) };
        mergeUnknownsIntoFast(propertyTarget, propValues, utils);
        mut_target.value[key] = propertyTarget.value;
    }
}
/**
 * The fast default strategy to merge maps into a target map without circular reference checks or depth limits.
 *
 * Assumes input is trusted and non-circular.
 *
 * @param mut_target - The target to merge into.
 * @param values - The maps (including the target's value if there is one).
 * @param utils - The utils.
 */
function mergeMapsIntoFast$1(mut_target, values, utils) {
    // See `mergeMapsInto` in `defaults/into.ts` for the full rationale.
    // Merge into `mut_target.value` in place.
    const valuesByKey = new Map();
    for (const value of values) {
        if (value === mut_target.value) {
            // `values` includes the target's own map when the recursion target
            // already had the key; its entries are merged via `target.get(key)`.
            continue;
        }
        for (const [key, entryValue] of value) {
            const mut_keyValues = valuesByKey.get(key);
            if (mut_keyValues === undefined) {
                valuesByKey.set(key, [entryValue]);
            }
            else {
                mut_keyValues.push(entryValue);
            }
        }
    }
    const target = mut_target.value;
    for (const [key, keyValues] of valuesByKey) {
        const targetValue = target.get(key);
        const allValues = targetValue === undefined ? keyValues : [targetValue, ...keyValues];
        const propTarget = targetValue === undefined ? { value: emptyLike(allValues[0]) } : { value: targetValue };
        mergeUnknownsIntoFast(propTarget, allValues, utils);
        target.set(key, propTarget.value);
    }
}
/**
 * The fast merge functions without circular reference checks.
 */
const mergeIntoFunctionsFast = {
    mergeRecords: mergeRecordsIntoFast$1,
    mergeArrays: mergeArraysInto$1,
    mergeSets: mergeSetsInto$1,
    mergeMaps: mergeMapsIntoFast$1,
    mergeOthers: mergeOthersInto$1,
};

const defaultDeepmergeIntoFastUnsafe = /* #__PURE__ */ deepmergeIntoFastUnsafeCustom();
function deepmergeIntoFastUnsafe(target, ...objects) {
    return void defaultDeepmergeIntoFastUnsafe(target, ...objects);
}
function deepmergeIntoFastUnsafeCustom(options = {}) {
    const utils = getUtilsFast(options, customizedDeepmergeIntoFast);
    function customizedDeepmergeIntoFast(target, ...objects) {
        mergeUnknownsIntoFast({ value: target }, [target, ...objects], utils);
    }
    return customizedDeepmergeIntoFast;
}
/**
 * Get the utils that are available to the merge functions in fast mode.
 *
 * @param options - The options the user specified.
 * @param customizedDeepmergeIntoFast - The customized deepmergeIntoFastUnsafe function.
 * @returns The fast merge into utils.
 */
function getUtilsFast(options, customizedDeepmergeIntoFast) {
    const defaultMergeFns = mergeIntoFunctionsFast;
    const defaultMetaDataUpd = defaultMetaDataUpdaterFast;
    return {
        defaultMergeFunctions: defaultMergeFns,
        mergeFunctions: resolveCustomMergeFunctions(options, defaultMergeFns),
        metaDataUpdater: defaultMetaDataUpd,
        deepmergeInto: customizedDeepmergeIntoFast,
        filterValues: options.filterValues === false
            ? undefined
            : typeof options.filterValues === "function"
                ? options.filterValues
                : defaultFilterValues,
        maxDepth: undefined,
        actions: actionsInto,
    };
}
/**
 * Merge unknown things into a target in fast mode without checking for circular references or depth limits.
 *
 * @param mut_target - The target to merge into.
 * @param values - The values.
 * @param utils - The utils.
 */
function mergeUnknownsIntoFast(mut_target, values, utils) {
    const filteredValues = utils.filterValues?.(values, undefined) ?? values;
    if (filteredValues.length === 0) {
        return;
    }
    if (filteredValues.length === 1) {
        return void mergeOthersIntoFast(mut_target, filteredValues, utils);
    }
    const type = getObjectType(mut_target.value);
    if (type !== ObjectType.NOT && type !== ObjectType.OTHER) {
        if (filteredValues.length === 2) {
            // Fast path: avoid loop overhead for 2 elements.
            if (getObjectType(filteredValues[1]) !== type) {
                return void mergeOthersIntoFast(mut_target, filteredValues, utils);
            }
        }
        else {
            // Slow path: 3 or more elements require full iteration.
            for (let mut_index = 1; mut_index < filteredValues.length; mut_index++) {
                if (getObjectType(filteredValues[mut_index]) !== type) {
                    return void mergeOthersIntoFast(mut_target, filteredValues, utils);
                }
            }
        }
    }
    switch (type) {
        case ObjectType.RECORD: {
            return void mergeRecordsIntoFast(mut_target, filteredValues, utils);
        }
        case ObjectType.ARRAY: {
            return void mergeArraysIntoFast(mut_target, filteredValues, utils);
        }
        case ObjectType.SET: {
            return void mergeSetsIntoFast(mut_target, filteredValues, utils);
        }
        case ObjectType.MAP: {
            return void mergeMapsIntoFast(mut_target, filteredValues, utils);
        }
        default: {
            return void mergeOthersIntoFast(mut_target, filteredValues, utils);
        }
    }
}
/**
 * Merge records into a target record in fast mode.
 *
 * @param mut_target - The target to merge into.
 * @param values - The records.
 * @param utils - The utils.
 */
function mergeRecordsIntoFast(mut_target, values, utils) {
    const action = utils.mergeFunctions.mergeRecords(mut_target, values, utils, undefined);
    if (action === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeRecords(mut_target, values, utils, undefined);
    }
}
/**
 * Merge arrays into a target array in fast mode.
 *
 * @param mut_target - The target to merge into.
 * @param values - The arrays.
 * @param utils - The utils.
 */
function mergeArraysIntoFast(mut_target, values, utils) {
    const action = utils.mergeFunctions.mergeArrays(mut_target, values, utils, undefined);
    if (action === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeArrays(mut_target, values);
    }
}
/**
 * Merge sets into a target set in fast mode.
 *
 * @param mut_target - The target to merge into.
 * @param values - The sets.
 * @param utils - The utils.
 */
function mergeSetsIntoFast(mut_target, values, utils) {
    const action = utils.mergeFunctions.mergeSets(mut_target, values, utils, undefined);
    if (action === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeSets(mut_target, values);
    }
}
/**
 * Merge maps into a target map in fast mode.
 *
 * @param mut_target - The target to merge into.
 * @param values - The maps.
 * @param utils - The utils.
 */
function mergeMapsIntoFast(mut_target, values, utils) {
    const action = utils.mergeFunctions.mergeMaps(mut_target, values, utils, undefined);
    if (action === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeMaps(mut_target, values, utils, undefined);
    }
}
/**
 * Merge other things into a target in fast mode.
 *
 * @param mut_target - The target to merge into.
 * @param values - The other things.
 * @param utils - The utils.
 */
function mergeOthersIntoFast(mut_target, values, utils) {
    const action = utils.mergeFunctions.mergeOthers(mut_target, values, utils, undefined);
    if (action === actionsInto.defaultMerge || mut_target.value === actionsInto.defaultMerge) {
        utils.defaultMergeFunctions.mergeOthers(mut_target, values);
    }
}

export { deepmerge, deepmergeCustom, deepmergeFastUnsafe, deepmergeFastUnsafeCustom, deepmergeInto, deepmergeIntoCustom, deepmergeIntoFastUnsafe, deepmergeIntoFastUnsafeCustom, getKeys, getKeysOfObjects, getObjectType, objectHasProperty };
