'use strict';

var parseley = require('parseley');

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var parseley__namespace = /*#__PURE__*/_interopNamespaceDefault(parseley);

var Ast$1 = /*#__PURE__*/Object.freeze({
    __proto__: null
});

var Types$1 = /*#__PURE__*/Object.freeze({
    __proto__: null
});

function treeify(nodes) {
    return '▽\n' + treeifyArray(nodes, thinLines);
}
const thinLines = [['├─', '│ '], ['└─', '  ']];
const heavyLines = [['┠─', '┃ '], ['┖─', '  ']];
const doubleLines = [['╟─', '║ '], ['╙─', '  ']];
function treeifyArray(nodes, tpl = heavyLines) {
    return prefixItems(tpl, nodes.map(n => treeifyNode(n)));
}
function treeifyNode(node) {
    switch (node.type) {
        case 'terminal': {
            const vctr = node.valueContainer;
            return `◁ #${vctr.index} ${JSON.stringify(vctr.specificity)} ${vctr.value}`;
        }
        case 'tagName':
            return `◻ Tag name\n${treeifyArray(node.variants, doubleLines)}`;
        case 'attrValue':
            return `▣ Attr value: ${node.name}\n${treeifyArray(node.matchers, doubleLines)}`;
        case 'attrPresence':
            return `◨ Attr presence: ${node.name}\n${treeifyArray(node.cont)}`;
        case 'pseudoClass':
            return `◪ Pseudo-class: ${node.name}\n${treeifyArray(node.cont)}`;
        case 'pushElement':
            return `◉ Push element: ${node.combinator}\n${treeifyArray(node.cont, thinLines)}`;
        case 'popElement':
            return `◌ Pop element\n${treeifyArray(node.cont, thinLines)}`;
        case 'variant':
            return `◇ = ${node.value}\n${treeifyArray(node.cont)}`;
        case 'matcher':
            return `◈ ${node.matcher} "${node.value}"${node.modifier || ''}\n${treeifyArray(node.cont)}`;
    }
}
function prefixItems(tpl, items) {
    return items
        .map((item, i, { length }) => prefixItem(tpl, item, i === length - 1))
        .join('\n');
}
function prefixItem(tpl, item, tail = true) {
    const tpl1 = tpl[tail ? 1 : 0];
    return tpl1[0] + item.split('\n').join('\n' + tpl1[1]);
}

var TreeifyBuilder = /*#__PURE__*/Object.freeze({
    __proto__: null,
    treeify: treeify
});

class DecisionTree {
    branches;
    constructor(input, options = {}) {
        this.branches = weave(toAstTerminalPairs(input, options));
    }
    build(builder) {
        return builder(this.branches);
    }
}
function toAstTerminalPairs(array, options) {
    const len = array.length;
    const results = new Array(len);
    for (let i = 0; i < len; i++) {
        const [selectorString, val] = array[i];
        const ast = parseley__namespace.parse1(selectorString);
        reduceSelectorVariants(ast);
        parseley__namespace.normalize(ast, {
            mode: 'html',
            attributesWithNormalizedValues: options.attributesWithNormalizedValues ?? [],
            allowUnspecifiedCaseSensitivityForAttributes: false,
        });
        results[i] = {
            ast: ast,
            terminal: {
                type: 'terminal',
                valueContainer: { index: i, value: val, specificity: ast.specificity },
            },
        };
    }
    return results;
}
function reduceSelectorVariants(ast) {
    const newList = [];
    ast.list.forEach((sel) => {
        switch (sel.type) {
            case 'class':
                newList.push({
                    matcher: '~=',
                    modifier: null,
                    name: 'class',
                    namespace: null,
                    specificity: sel.specificity,
                    type: 'attrValue',
                    value: sel.name,
                });
                break;
            case 'id':
                newList.push({
                    matcher: '=',
                    modifier: null,
                    name: 'id',
                    namespace: null,
                    specificity: [0, 1, 0],
                    type: 'attrValue',
                    value: sel.name,
                });
                break;
            case 'combinator':
                reduceSelectorVariants(sel.left);
                newList.push(sel);
                break;
            case 'universal':
                break;
            default:
                newList.push(sel);
                break;
        }
    });
    ast.list = newList;
}
function weave(items) {
    const branches = [];
    while (items.length) {
        const topKind = findTopKey(items, (_sel) => true, getSelectorKind);
        const { matches, nonMatches, empty } = breakByKind(items, topKind);
        items = nonMatches;
        if (matches.length) {
            branches.push(branchOfKind(topKind, matches));
        }
        if (empty.length) {
            branches.push(...terminate(empty));
        }
    }
    return branches;
}
function terminate(items) {
    const results = [];
    for (const item of items) {
        const terminal = item.terminal;
        if (terminal.type === 'terminal') {
            results.push(terminal);
        }
        else {
            const { matches, rest } = partition(terminal.cont, (node) => node.type === 'terminal');
            matches.forEach(node => results.push(node));
            if (rest.length) {
                terminal.cont = rest;
                results.push(terminal);
            }
        }
    }
    return results;
}
function breakByKind(items, selectedKind) {
    const matches = [];
    const nonMatches = [];
    const empty = [];
    for (const item of items) {
        const simpleSelectors = item.ast.list;
        if (simpleSelectors.length) {
            const isMatch = simpleSelectors.some(node => getSelectorKind(node) === selectedKind);
            (isMatch ? matches : nonMatches).push(item);
        }
        else {
            empty.push(item);
        }
    }
    return { matches, nonMatches, empty };
}
function getSelectorKind(sel) {
    switch (sel.type) {
        case 'attrPresence':
            return `attrPresence ${sel.name}`;
        case 'attrValue':
            return `attrValue ${sel.name}`;
        case 'pc':
            return `pc ${sel.name}`;
        case 'combinator':
            return `combinator ${sel.combinator}`;
        default:
            return sel.type;
    }
}
function branchOfKind(kind, items) {
    if (kind === 'tag') {
        return tagNameBranch(items);
    }
    if (kind.startsWith('attrValue ')) {
        return attrValueBranch(kind.substring(10), items);
    }
    if (kind.startsWith('attrPresence ')) {
        return attrPresenceBranch(kind.substring(13), items);
    }
    if (kind.startsWith('pc ')) {
        return pseudoClassBranch(kind.substring(3), items);
    }
    if (kind === 'combinator >') {
        return combinatorBranch('>', items);
    }
    if (kind === 'combinator +') {
        return combinatorBranch('+', items);
    }
    throw new Error(`Unsupported selector kind: ${kind}`);
}
function tagNameBranch(items) {
    const groups = spliceAndGroup(items, (x) => x.type === 'tag', x => x.name);
    const variants = Object.entries(groups).map(([name, group]) => ({
        type: 'variant',
        value: name,
        cont: weave(group.items),
    }));
    return {
        type: 'tagName',
        variants: variants,
    };
}
function attrPresenceBranch(name, items) {
    for (const item of items) {
        spliceSimpleSelector(item, (x) => (x.type === 'attrPresence') && (x.name === name));
    }
    return {
        type: 'attrPresence',
        name: name,
        cont: weave(items),
    };
}
function attrValueBranch(name, items) {
    const groups = spliceAndGroup(items, (x) => (x.type === 'attrValue') && (x.name === name), x => `${x.matcher} ${x.modifier || ''} ${x.value}`);
    const matchers = [];
    for (const group of Object.values(groups)) {
        const sel = group.oneSimpleSelector;
        matchers.push({
            type: 'matcher',
            matcher: sel.matcher,
            modifier: sel.modifier,
            value: sel.value,
            predicate: getAttrValuePredicate(sel),
            cont: weave(group.items),
        });
    }
    return {
        type: 'attrValue',
        name: name,
        matchers: matchers,
    };
}
function getAttrValuePredicate(sel) {
    if (sel.modifier === 'i') {
        const expected = sel.value.toLowerCase();
        switch (sel.matcher) {
            case '=':
                return actual => expected === actual.toLowerCase();
            case '~=':
                return actual => actual.toLowerCase().split(/[ \t]+/).includes(expected);
            case '^=':
                return actual => actual.toLowerCase().startsWith(expected);
            case '$=':
                return actual => actual.toLowerCase().endsWith(expected);
            case '*=':
                return actual => actual.toLowerCase().includes(expected);
            case '|=':
                return (actual) => {
                    const lower = actual.toLowerCase();
                    return (expected === lower) || (lower.startsWith(expected) && lower[expected.length] === '-');
                };
        }
    }
    else {
        const expected = sel.value;
        switch (sel.matcher) {
            case '=':
                return actual => expected === actual;
            case '~=':
                return actual => actual.split(/[ \t]+/).includes(expected);
            case '^=':
                return actual => actual.startsWith(expected);
            case '$=':
                return actual => actual.endsWith(expected);
            case '*=':
                return actual => actual.includes(expected);
            case '|=':
                return actual => (expected === actual) || (actual.startsWith(expected) && actual[expected.length] === '-');
        }
    }
}
function pseudoClassBranch(name, items) {
    if (name !== 'empty'
        && name !== 'only-child'
        && name !== 'first-child'
        && name !== 'last-child'
        && name !== 'any-link') {
        throw new Error(`Unsupported pseudo-class: :${name}`);
    }
    for (const item of items) {
        spliceSimpleSelector(item, (x) => (x.type === 'pc') && (x.name === name));
    }
    return {
        type: 'pseudoClass',
        name: name,
        cont: weave(items),
    };
}
function combinatorBranch(combinator, items) {
    const groups = spliceAndGroup(items, (x) => (x.type === 'combinator') && (x.combinator === combinator), x => parseley__namespace.serialize(x.left));
    const leftItems = [];
    for (const group of Object.values(groups)) {
        const rightCont = weave(group.items);
        const leftAst = group.oneSimpleSelector.left;
        leftItems.push({
            ast: leftAst,
            terminal: { type: 'popElement', cont: rightCont },
        });
    }
    return {
        type: 'pushElement',
        combinator: combinator,
        cont: weave(leftItems),
    };
}
function spliceAndGroup(items, predicate, keyCallback) {
    const groups = {};
    while (items.length) {
        const bestKey = findTopKey(items, predicate, keyCallback);
        const bestKeyPredicate = (sel) => predicate(sel) && keyCallback(sel) === bestKey;
        const hasBestKeyPredicate = (item) => item.ast.list.some(bestKeyPredicate);
        const { matches, rest } = partition(items, hasBestKeyPredicate);
        let oneSimpleSelector = null;
        for (const item of matches) {
            const splicedNode = spliceSimpleSelector(item, bestKeyPredicate);
            if (!oneSimpleSelector) {
                oneSimpleSelector = splicedNode;
            }
        }
        if (oneSimpleSelector == null) {
            throw new Error('No simple selector is found.');
        }
        groups[bestKey] = { oneSimpleSelector: oneSimpleSelector, items: matches };
        items = rest;
    }
    return groups;
}
function spliceSimpleSelector(item, predicate) {
    const simpleSelectors = item.ast.list;
    const matches = new Array(simpleSelectors.length);
    let firstIndex = -1;
    for (let i = simpleSelectors.length; i-- > 0;) {
        if (predicate(simpleSelectors[i])) {
            matches[i] = true;
            firstIndex = i;
        }
    }
    if (firstIndex == -1) {
        throw new Error(`Couldn't find the required simple selector.`);
    }
    const result = simpleSelectors[firstIndex];
    item.ast.list = simpleSelectors.filter((_, i) => !matches[i]);
    return result;
}
function findTopKey(items, predicate, keyCallback) {
    const candidates = {};
    for (const item of items) {
        const candidates1 = {};
        for (const node of item.ast.list.filter(predicate)) {
            candidates1[keyCallback(node)] = true;
        }
        for (const key of Object.keys(candidates1)) {
            if (candidates[key]) {
                candidates[key]++;
            }
            else {
                candidates[key] = 1;
            }
        }
    }
    let topKind = '';
    let topCounter = 0;
    for (const entry of Object.entries(candidates)) {
        if (entry[1] > topCounter) {
            topKind = entry[0];
            topCounter = entry[1];
        }
    }
    return topKind;
}
function partition(src, predicate) {
    const matches = [];
    const rest = [];
    for (const x of src) {
        if (predicate(x)) {
            matches.push(x);
        }
        else {
            rest.push(x);
        }
    }
    return { matches, rest };
}

class Picker {
    f;
    constructor(f) {
        this.f = f;
    }
    pickAll(el) {
        return this.f(el);
    }
    pick1(el, preferFirst = false) {
        const results = this.f(el);
        const len = results.length;
        if (len === 0) {
            return null;
        }
        if (len === 1) {
            return results[0].value;
        }
        const comparator = (preferFirst)
            ? comparatorPreferFirst
            : comparatorPreferLast;
        let result = results[0];
        for (let i = 1; i < len; i++) {
            const next = results[i];
            if (comparator(result, next)) {
                result = next;
            }
        }
        return result.value;
    }
}
function comparatorPreferFirst(acc, next) {
    const diff = parseley.compareSpecificity(next.specificity, acc.specificity);
    return diff > 0 || (diff === 0 && next.index < acc.index);
}
function comparatorPreferLast(acc, next) {
    const diff = parseley.compareSpecificity(next.specificity, acc.specificity);
    return diff > 0 || (diff === 0 && next.index > acc.index);
}

exports.Ast = Ast$1;
exports.DecisionTree = DecisionTree;
exports.Picker = Picker;
exports.Treeify = TreeifyBuilder;
exports.Types = Types$1;
