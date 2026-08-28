const linebreaksRe = /\n/g;
function createPositionQuery(str) {
    const offsets = [...str.matchAll(linebreaksRe)].map(m => m.index || 0);
    offsets.unshift(-1);
    let lineIndex = 1;
    return (offset) => {
        while (lineIndex > 1 && offset < offsets[lineIndex - 1]) {
            lineIndex--;
        }
        while (lineIndex < offsets.length && offset > offsets[lineIndex]) {
            lineIndex++;
        }
        return { line: lineIndex, column: offset - offsets[lineIndex - 1] };
    };
}

function toUnifiedRule(r, i) {
    return {
        name: r.name,
        discard: r.discard,
        push: r.push,
        pop: r.pop,
        regex: toRegExp(r, i),
        replacer: isReplacementRule(r)
            ? toReplacer(r.regex, r.replace)
            : undefined,
    };
}
function isStringRule(r) {
    return Object.prototype.hasOwnProperty.call(r, 'str');
}
function isRegexRule(r) {
    return Object.prototype.hasOwnProperty.call(r, 'regex');
}
function isReplacementRule(r) {
    return Object.prototype.hasOwnProperty.call(r, 'replace');
}
function toReplacer(re, replace) {
    const replaceSearch = toNonSticky(re);
    return (match) => match.replace(replaceSearch, replace);
}
function toRegExp(r, i) {
    if (r.name.length === 0) {
        throw new Error(`Rule #${i} has empty name, which is not allowed.`);
    }
    if (isRegexRule(r)) {
        return toSticky(r.regex);
    }
    if (isStringRule(r)) {
        if (r.str.length === 0) {
            throw new Error(`Rule #${i} ("${r.name}") has empty "str" property, which is not allowed.`);
        }
        return new RegExp(escapeRegExp(r.str), 'y');
    }
    return new RegExp(escapeRegExp(r.name), 'y');
}
function escapeRegExp(str) {
    return str.replace(/[-[\]{}()*+!<=:?./\\^$|#\s,]/g, '\\$&');
}
function toSticky(re) {
    if (re.global) {
        throw new Error(`Regular expression /${re.source}/${re.flags} contains the global flag, which is not allowed.`);
    }
    return (re.sticky)
        ? re
        : new RegExp(re.source, re.flags + 'y');
}
function toNonSticky(re) {
    return (re.sticky)
        ? new RegExp(re.source, re.flags.replace('y', ''))
        : re;
}

function createLexer(rules, state = '', options = {}) {
    const options1 = (typeof state !== 'string') ? state : options;
    const state1 = (typeof state === 'string') ? state : '';
    const unifiedRules = rules.map(toUnifiedRule);
    const isLineNumbers = !!options1.lineNumbers;
    return function (str, offset = 0) {
        const positionQuery = (isLineNumbers)
            ? createPositionQuery(str)
            : undefined;
        let position = { line: 0, column: 0 };
        let currentIndex = offset;
        const tokens = [];
        loopStr: while (currentIndex < str.length) {
            let anyMatch = false;
            for (const rule of unifiedRules) {
                rule.regex.lastIndex = currentIndex;
                const match = rule.regex.exec(str);
                if (match && match[0].length > 0) {
                    if (!rule.discard) {
                        if (positionQuery) {
                            position = positionQuery(currentIndex);
                        }
                        tokens.push({
                            state: state1,
                            name: rule.name,
                            text: (rule.replacer) ? rule.replacer(match[0]) : match[0],
                            offset: currentIndex,
                            len: match[0].length,
                            line: position.line,
                            column: position.column,
                        });
                    }
                    currentIndex = rule.regex.lastIndex;
                    anyMatch = true;
                    if (rule.push) {
                        const r = rule.push(str, currentIndex);
                        tokens.push(...r.tokens);
                        currentIndex = r.offset;
                    }
                    if (rule.pop) {
                        break loopStr;
                    }
                    break;
                }
            }
            if (!anyMatch) {
                break;
            }
        }
        return {
            tokens: tokens,
            offset: currentIndex,
            complete: str.length <= currentIndex,
        };
    };
}

export { createLexer };
