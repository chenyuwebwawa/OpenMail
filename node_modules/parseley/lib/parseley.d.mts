import * as Ast from './ast.mjs';
export { Ast };

/**
 * Parse a CSS selector string.
 *
 * This function supports comma-separated selector lists
 * and always returns an AST starting from a node of type `list`.
 *
 * @param str - CSS selector string (can contain commas).
 */
declare function parse(str: string): Ast.ListSelector;
/**
 * Parse a CSS selector string.
 *
 * This function does not support comma-separated selector lists
 * and always returns an AST starting from a node of type `compound`.
 *
 * @param str - CSS selector string (no commas).
 */
declare function parse1(str: string): Ast.CompoundSelector;

/**
 * Convert a selector AST back to a string representation.
 *
 * Note: formatting is not preserved in the AST.
 *
 * @param selector - A selector AST object.
 */
declare function serialize(selector: Ast.Selector): string;

/**
 * Options controlling how `normalize()` canonicalizes a selector AST.
 */
type NormalizeOptions = {
    /**
     * Case-folding mode.
     *
     * - `html` (default): lowercases element/attribute names and namespace prefixes.
     * - `xml`: preserves case for those parts.
     */
    mode?: 'html' | 'xml';
    /**
     * Attribute names whose *values* should be lowercased by default.
     *
     * Used only for attribute value selectors (`[name="value"]`)
     * with no explicit case-sensitivity modifier (`i` or `s`).
     *
     * Is not affected by the `mode` option.
     */
    attributesWithNormalizedValues?: string[];
    /**
     * When `false` (default), `normalize()` makes missing attribute value modifiers explicit (`i` or `s`).
     * When `true`, missing modifiers remain unspecified.
     *
     * All attribute value selectors are considered case-sensitive (`s`) unless:
     *
     * - they have an explicit `i` modifier, or
     * - their attribute name is listed in `attributesWithNormalizedValues`.
     */
    allowUnspecifiedCaseSensitivityForAttributes?: boolean;
};
/**
 * Modifies the given AST **in place** to a canonical form and stable ordering.
 * Returns the AST.
 *
 * Intended for consistent processing, easy comparison of equivalent selectors,
 * and normalized `serialize()` output.
 *
 * @param selector - A selector AST object.
 * @param options - Normalization options.
 */
declare function normalize(selector: Ast.Selector, options?: NormalizeOptions): Ast.Selector;

/**
 * Compare selectors based on their specificity.
 *
 * Usable as a comparator for sorting.
 *
 * @param a - First selector.
 * @param b - Second selector.
 */
declare function compareSelectors(a: Ast.SimpleSelector | Ast.CompoundSelector, b: Ast.SimpleSelector | Ast.CompoundSelector): number;
/**
 * Compare specificity values without reducing them
 * as arbitrary base numbers.
 *
 * Usable as a comparator for sorting.
 *
 * @param a - First specificity value.
 * @param b - Second specificity value.
 */
declare function compareSpecificity(a: Ast.Specificity, b: Ast.Specificity): number;

export { compareSelectors, compareSpecificity, normalize, parse, parse1, serialize };
export type { NormalizeOptions };
