/**
 * Abstract Syntax Tree (AST) for CSS selectors.
 *
 * Does not preserve original textual representation such as spacing, quoting style, etc.
 *
 * Does preserve all information necessary to serialize back to equivalent selector string.
 *
 * @packageDocumentation
 */
/**
 * Specificity as defined by Selectors spec.
 *
 * {@link https://www.w3.org/TR/selectors/#specificity}
 *
 * Three levels: for id, class, tag (type).
 *
 * Extra level(s) used in HTML styling don't fit the scope of this package
 * and no space reserved for them.
 */
type Specificity = [number, number, number];
/**
 * The `*` selector.
 *
 * {@link https://www.w3.org/TR/selectors/#the-universal-selector}
 *
 * `parseley` considers tag name and universal selectors to be unrelated entities
 * for simplicity of processing.
 */
type UniversalSelector = {
    type: 'universal';
    namespace: string | null;
    specificity: [0, 0, 0];
};
/**
 * Tag name (type) selector.
 *
 * {@link https://www.w3.org/TR/selectors/#type-selectors}
 *
 * `parseley` considers tag name and universal selectors to be unrelated entities
 * for simplicity of processing.
 */
type TagSelector = {
    type: 'tag';
    name: string;
    namespace: string | null;
    specificity: [0, 0, 1];
};
/**
 * Class selector (`.class`).
 *
 * {@link https://www.w3.org/TR/selectors/#class-html}
 */
type ClassSelector = {
    type: 'class';
    name: string;
    specificity: [0, 1, 0];
};
/**
 * Id selector (`#id`).
 *
 * {@link https://www.w3.org/TR/selectors/#id-selectors}
 */
type IdSelector = {
    type: 'id';
    name: string;
    specificity: [1, 0, 0];
};
/**
 * Attribute presence selector (`[attr]`).
 *
 * {@link https://www.w3.org/TR/selectors/#attribute-selectors}
 *
 * `parseley` considers attribute presence and value selectors to be unrelated entities
 * for simplicity of processing.
 */
type AttributePresenceSelector = {
    type: 'attrPresence';
    name: string;
    namespace: string | null;
    specificity: [0, 1, 0];
};
/**
 * Attribute value selector (`[attr=value]`).
 *
 * {@link https://www.w3.org/TR/selectors/#attribute-selectors}
 *
 * `parseley` considers attribute presence and value selectors to be unrelated entities
 * for simplicity of processing.
 */
type AttributeValueSelector = {
    type: 'attrValue';
    name: string;
    namespace: string | null;
    matcher: '=' | '~=' | '|=' | '^=' | '$=' | '*=';
    value: string;
    modifier: 'i' | 's' | null;
    specificity: [0, 1, 0];
};
type PseudoClassSelector = {
    type: 'pc';
    name: string;
    specificity: [0, 1, 0];
};
type IsSelector = {
    type: 'fpc:is';
    name: string;
    list: CompoundSelector[];
    specificity: Specificity;
};
type WhereSelector = {
    type: 'fpc:where';
    name: string;
    list: CompoundSelector[];
    specificity: [0, 0, 0];
};
type NotSelector = {
    type: 'fpc:not';
    name: string;
    list: CompoundSelector[];
    specificity: Specificity;
};
type FunctionalPseudoClassSelector = IsSelector | WhereSelector | NotSelector;
/**
 * Represents a selectors combinator with what's on the left side of it.
 *
 * {@link https://www.w3.org/TR/selectors/#combinators}
 */
type Combinator = {
    type: 'combinator';
    combinator: ' ' | '+' | '>' | '~' | '||';
    left: CompoundSelector;
    specificity: Specificity;
};
/**
 * Any thing representing a single condition on an element.
 *
 * {@link https://www.w3.org/TR/selectors/#simple}
 *
 * `parseley` deviates from the spec here by adding `Combinator` to the enumeration.
 * This is done for simplicity of processing.
 *
 * Combinator effectively considered an extra condition on a specific element
 * (*"have this kind of element in relation"*).
 */
type SimpleSelector = UniversalSelector | TagSelector | ClassSelector | IdSelector | AttributePresenceSelector | AttributeValueSelector | FunctionalPseudoClassSelector | PseudoClassSelector | Combinator;
/**
 * Compound selector - a set of conditions describing a single element.
 *
 * {@link https://www.w3.org/TR/selectors/#compound}
 *
 * {@link https://www.w3.org/TR/selectors/#complex}
 *
 * Important note: due to the way `parseley` represents combinators,
 * every compound selector is also a complex selector with everything
 * connected from the left side.
 * Specificity value also includes any extra weight added by the left side.
 *
 * If there is a combinator in the selector - it is guaranteed to be
 * the last entry in the list of inner selectors.
 */
type CompoundSelector = {
    type: 'compound';
    list: SimpleSelector[];
    specificity: Specificity;
};
/**
 * Represents a comma-separated list of compound selectors.
 *
 * {@link https://www.w3.org/TR/selectors/#selector-list}
 *
 * As this kind of selector can combine different ways to match elements,
 * a single specificity value doesn't make sense for it and therefore absent.
 */
type ListSelector = {
    type: 'list';
    list: CompoundSelector[];
};
/**
 * Any kind of selector supported by `parseley`.
 */
type Selector = ListSelector | CompoundSelector | SimpleSelector;

export type { AttributePresenceSelector, AttributeValueSelector, ClassSelector, Combinator, CompoundSelector, FunctionalPseudoClassSelector, IdSelector, IsSelector, ListSelector, NotSelector, PseudoClassSelector, Selector, SimpleSelector, Specificity, TagSelector, UniversalSelector, WhereSelector };
