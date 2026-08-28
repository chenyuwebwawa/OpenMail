'use strict';

var domhandler = require('domhandler');
var domelementtype = require('domelementtype');
var selderee = require('selderee');

function hp2Builder(nodes) {
    return new selderee.Picker(handleArray(nodes));
}
function handleArray(nodes) {
    const matchers = nodes.map(handleNode);
    return (el, ...tail) => matchers.flatMap(m => m(el, ...tail));
}
function handleNode(node) {
    switch (node.type) {
        case 'terminal': {
            const result = [node.valueContainer];
            return () => result;
        }
        case 'tagName':
            return handleTagName(node);
        case 'attrValue':
            return handleAttrValueName(node);
        case 'attrPresence':
            return handleAttrPresenceName(node);
        case 'pseudoClass':
            return handlePseudoClassNode(node);
        case 'pushElement':
            return handlePushElementNode(node);
        case 'popElement':
            return handlePopElementNode(node);
    }
}
function handleTagName(node) {
    const variants = {};
    for (const variant of node.variants) {
        variants[variant.value] = handleArray(variant.cont);
    }
    return (el, ...tail) => {
        const continuation = variants[el.name];
        return (continuation) ? continuation(el, ...tail) : [];
    };
}
function handleAttrPresenceName(node) {
    const attrName = node.name;
    const continuation = handleArray(node.cont);
    return (el, ...tail) => (Object.prototype.hasOwnProperty.call(el.attribs, attrName))
        ? continuation(el, ...tail)
        : [];
}
function handleAttrValueName(node) {
    const callbacks = [];
    for (const matcher of node.matchers) {
        const predicate = matcher.predicate;
        const continuation = handleArray(matcher.cont);
        callbacks.push((attr, el, ...tail) => (predicate(attr) ? continuation(el, ...tail) : []));
    }
    const attrName = node.name;
    return (el, ...tail) => {
        const attr = el.attribs[attrName];
        return (attr || attr === '')
            ? callbacks.flatMap(cb => cb(attr, el, ...tail))
            : [];
    };
}
function handlePseudoClassNode(node) {
    const continuation = handleArray(node.cont);
    const predicate = pseudoClassPredicates[node.name];
    if (!predicate) {
        throw new Error(`Unsupported pseudo-class: :${node.name}`);
    }
    return (el, ...tail) => predicate(el) ? continuation(el, ...tail) : [];
}
const pseudoClassPredicates = {
    'empty': isEmptyElement,
    'only-child': isOnlyChildElement,
    'first-child': isFirstChildElement,
    'last-child': isLastChildElement,
    'any-link': isAnyLinkElement,
};
function isEmptyElement(el) {
    for (const child of el.children) {
        if (domhandler.isTag(child)) {
            return false;
        }
        if (child.type === domelementtype.ElementType.Text || child.type === domelementtype.ElementType.CDATA) {
            return false;
        }
    }
    return true;
}
function isOnlyChildElement(el) {
    return getPrecedingElement(el) === null && getFollowingElement(el) === null;
}
function isFirstChildElement(el) {
    return getPrecedingElement(el) === null;
}
function isLastChildElement(el) {
    return getFollowingElement(el) === null;
}
function isAnyLinkElement(el) {
    return (el.name === 'a' || el.name === 'area')
        && Object.prototype.hasOwnProperty.call(el.attribs, 'href');
}
function handlePushElementNode(node) {
    const continuation = handleArray(node.cont);
    const leftElementGetter = (node.combinator === '+')
        ? getPrecedingElement
        : getParentElement;
    return (el, ...tail) => {
        const next = leftElementGetter(el);
        if (next === null) {
            return [];
        }
        return continuation(next, el, ...tail);
    };
}
const getPrecedingElement = (el) => {
    const prev = el.prev;
    if (prev === null) {
        return null;
    }
    return (domhandler.isTag(prev)) ? prev : getPrecedingElement(prev);
};
const getFollowingElement = (el) => {
    const next = el.next;
    if (next === null) {
        return null;
    }
    return (domhandler.isTag(next)) ? next : getFollowingElement(next);
};
const getParentElement = (el) => {
    const parent = el.parent;
    return (parent && domhandler.isTag(parent)) ? parent : null;
};
function handlePopElementNode(node) {
    const continuation = handleArray(node.cont);
    return (_el, next, ...tail) => continuation(next, ...tail);
}

exports.hp2Builder = hp2Builder;
