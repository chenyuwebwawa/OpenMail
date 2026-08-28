import { Element } from 'domhandler';
import { Ast, Picker } from 'selderee';

/**
 * Decision tree builder for [htmlparser2](https://github.com/fb55/htmlparser2)/[domhandler](https://github.com/fb55/domhandler) DOM AST.
 *
 * @packageDocumentation
 */

/**
 * A {@link Types.BuilderFunction} implementation.
 *
 * Creates a function (in a {@link Picker} wrapper) that can run
 * the decision tree against `htmlparser2`/`domhandler` {@link Element} nodes.
 *
 * @typeParam V - the type of values associated with selectors.
 *
 * @param nodes - nodes ({@link Ast.DecisionTreeNode})
 * from the root level of the decision tree.
 *
 * @returns a {@link Picker} object.
 */
declare function hp2Builder<V>(nodes: Ast.DecisionTreeNode<V>[]): Picker<Element, V>;

export { hp2Builder };
