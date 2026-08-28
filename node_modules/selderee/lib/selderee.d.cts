/**
 * Decision tree node definitions.
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
 * Container for the associated value,
 * selector specificity and position in the selectors collection.
 *
 * @typeParam V - the type of the associated value.
 */
type ValueContainer<V> = {
    index: number;
    specificity: Specificity;
    value: V;
};
/**
 * When reached a terminal node, decision tree adds
 * the value container to the list of successful matches.
 */
type TerminalNode<V> = {
    type: 'terminal';
    valueContainer: ValueContainer<V>;
};
/**
 * Tag name has to be checked.
 * Underlying variants can be assembled
 * into a dictionary key check.
 */
type TagNameNode<V> = {
    type: 'tagName';
    variants: VariantNode<V>[];
};
/**
 * String value variant.
 */
type VariantNode<V> = {
    type: 'variant';
    value: string;
    cont: DecisionTreeNode<V>[];
};
/**
 * Have to check the presence of an element attribute
 * with the given name.
 */
type AttrPresenceNode<V> = {
    type: 'attrPresence';
    name: string;
    cont: DecisionTreeNode<V>[];
};
/**
 * Have to check the value of an element attribute
 * with the given name.
 * It usually requires to run all underlying matchers
 * one after another.
 */
type AttrValueNode<V> = {
    type: 'attrValue';
    name: string;
    matchers: MatcherNode<V>[];
};
/**
 * String value matcher.
 * Contains the predicate so no need to reimplement it
 * from descriptive parameters.
 */
type MatcherNode<V> = {
    type: 'matcher';
    matcher: '=' | '~=' | '|=' | '^=' | '$=' | '*=';
    modifier: 'i' | 's' | null;
    value: string;
    predicate: (prop: string) => boolean;
    cont: DecisionTreeNode<V>[];
};
/**
 * Simple pseudo-class condition has to be checked.
 */
type PseudoClassNode<V> = {
    type: 'pseudoClass';
    name: string;
    cont: DecisionTreeNode<V>[];
};
/**
 * Push next element on the stack, defined by the combinator.
 * Only `>` and `+` are expected to be supported.
 *
 * All checks are performed on the element on top of the stack.
 */
type PushElementNode<V> = {
    type: 'pushElement';
    combinator: '>' | '+';
    cont: DecisionTreeNode<V>[];
};
/**
 * Remove the top element from the stack -
 * following checks are performed on the previous element.
 */
type PopElementNode<V> = {
    type: 'popElement';
    cont: DecisionTreeNode<V>[];
};
type DecisionTreeNode<V> = TerminalNode<V> | TagNameNode<V> | AttrPresenceNode<V> | AttrValueNode<V> | PseudoClassNode<V> | PushElementNode<V> | PopElementNode<V>;

type Ast_AttrPresenceNode<V> = AttrPresenceNode<V>;
type Ast_AttrValueNode<V> = AttrValueNode<V>;
type Ast_DecisionTreeNode<V> = DecisionTreeNode<V>;
type Ast_MatcherNode<V> = MatcherNode<V>;
type Ast_PopElementNode<V> = PopElementNode<V>;
type Ast_PseudoClassNode<V> = PseudoClassNode<V>;
type Ast_PushElementNode<V> = PushElementNode<V>;
type Ast_Specificity = Specificity;
type Ast_TagNameNode<V> = TagNameNode<V>;
type Ast_TerminalNode<V> = TerminalNode<V>;
type Ast_ValueContainer<V> = ValueContainer<V>;
type Ast_VariantNode<V> = VariantNode<V>;
declare namespace Ast {
  export type { Ast_AttrPresenceNode as AttrPresenceNode, Ast_AttrValueNode as AttrValueNode, Ast_DecisionTreeNode as DecisionTreeNode, Ast_MatcherNode as MatcherNode, Ast_PopElementNode as PopElementNode, Ast_PseudoClassNode as PseudoClassNode, Ast_PushElementNode as PushElementNode, Ast_Specificity as Specificity, Ast_TagNameNode as TagNameNode, Ast_TerminalNode as TerminalNode, Ast_ValueContainer as ValueContainer, Ast_VariantNode as VariantNode };
}

/**
 * Function types for builders and matchers.
 *
 * @packageDocumentation
 */

/**
 * A function that turn a decision tree into a callable form.
 *
 * To be implemented by builder plugins.
 *
 * @typeParam V - the type of associated value.
 *
 * @typeParam R - return type for this builder
 * (Consider using {@link Picker}.)
 */
type BuilderFunction<V, R> = (nodes: DecisionTreeNode<V>[]) => R;
/**
 * Recommended matcher function shape to implement in builders.
 *
 * The elements stack is represented as the arguments array.
 *
 * @typeParam L - the type of elements in a particular DOM AST.
 * @typeParam V - the type of associated value.
 */
type MatcherFunction<L, V> = (el: L, ...tail: L[]) => ValueContainer<V>[];

type Types_BuilderFunction<V, R> = BuilderFunction<V, R>;
type Types_MatcherFunction<L, V> = MatcherFunction<L, V>;
declare namespace Types {
  export type { Types_BuilderFunction as BuilderFunction, Types_MatcherFunction as MatcherFunction };
}

/**
 * Basic {@link BuilderFunction} implementation
 * for decision tree visualization.
 *
 * @packageDocumentation
 */

/**
 * A {@link BuilderFunction} implementation.
 *
 * Produces a string representation of the tree
 * for testing and debug purposes.
 *
 * Only accepts `string` as the associated value type.
 * Map your input collection before creating a {@link DecisionTree}
 * if you want to use it with a different type -
 * the decision on how to stringify the value is up to you.
 *
 * @param nodes - nodes from the root level of the decision tree.
 * @returns the string representation of the tree.
 */
declare function treeify(nodes: DecisionTreeNode<string>[]): string;

declare const TreeifyBuilder_treeify: typeof treeify;
declare namespace TreeifyBuilder {
  export {
    TreeifyBuilder_treeify as treeify,
  };
}

/**
 * Options for DecisionTree construction.
 */
type DecisionTreeOptions = {
    /**
     * Attribute names whose values should be case-insensitive by default.
     *
     * Only affects attribute value selectors (`[name="value"]`) with no explicit case-sensitivity modifier (`i` or `s`).
     */
    attributesWithNormalizedValues?: string[];
};
/**
 * CSS selectors decision tree.
 * Data structure that weaves similar selectors together
 * in order to minimize the number of checks required
 * to find the ones matching a given HTML element.
 *
 * Converted into a functioning implementation via plugins
 * tailored for specific DOM ASTs.
 *
 * @typeParam V - the type of values associated with selectors.
 */
declare class DecisionTree<V> {
    private readonly branches;
    /**
     * Create new DecisionTree object.
     *
     * @param input - an array containing all selectors
     * paired with associated values.
     * @param options - optional configuration for the decision tree.
     *
     * @typeParam V - the type of values associated with selectors.
     */
    constructor(input: [string, V][], options?: DecisionTreeOptions);
    /**
     * Turn this decision tree into a callable form.
     *
     * @typeParam R - return type defined by the builder function.
     *
     * @param builder - the builder function.
     *
     * @returns the decision tree in a form ready for use.
     */
    build<R>(builder: BuilderFunction<V, R>): R;
}

/**
 * Simple wrapper around the matcher function.
 * Recommended return type for builder plugins.
 *
 * @typeParam L - the type of HTML Element in the targeted DOM AST.
 * @typeParam V - the type of associated values.
 */
declare class Picker<L, V> {
    private f;
    /**
     * Create new Picker object.
     *
     * @typeParam L - the type of HTML Element in the targeted DOM AST.
     * @typeParam V - the type of associated values.
     *
     * @param f - the function that matches an element
     * and returns all associated values.
     */
    constructor(f: MatcherFunction<L, V>);
    /**
     * Run the selectors decision tree against one HTML Element
     * and return all matched associated values
     * along with selector specificities.
     *
     * Client code then decides how to further process them
     * (sort, filter, etc).
     *
     * @param el - an HTML Element.
     *
     * @returns all associated values along with
     * selector specificities for all matched selectors.
     */
    pickAll(el: L): ValueContainer<V>[];
    /**
     * Run the selectors decision tree against one HTML Element
     * and choose the value from the most specific matched selector.
     *
     * @param el - an HTML Element.
     *
     * @param preferFirst - option to define which value to choose
     * when there are multiple matches with equal specificity.
     *
     * @returns the value from the most specific matched selector
     * or `null` if nothing matched.
     */
    pick1(el: L, preferFirst?: boolean): V | null;
}

export { Ast, DecisionTree, Picker, TreeifyBuilder as Treeify, Types };
export type { DecisionTreeOptions };
