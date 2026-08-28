import { Parser, Data, Matcher } from './core.mjs';

/**
 * Constructs a tuple type from the characters of a given string.
 *
 * @category Utility types
 */
type CharUnion<TChars extends string> = string extends TChars ? string : TChars extends `${infer First}${infer Rest}` ? First | CharUnion<Rest> : never;

/**
 * Constructs a tuple type from the elements of a given string or array of strings.
 *
 * @category Utility types
 */
type GraphemeUnion<TGraphemes extends string | string[]> = TGraphemes extends string ? CharUnion<TGraphemes> : TGraphemes extends string[] ? TGraphemes[number] : never;

/**
 * Make a parser that looks for the exact match for a given character
 * and returns a match with that character.
 *
 * Tokens expected to be individual characters/graphemes.
 *
 * @param char - A character to look for.
 */
declare function char<TOptions, const TChar extends string>(char: TChar): Parser<string, TOptions, TChar>;

/**
 * Make a parser that matches and returns a character
 * if it is present in a given character samples string/array.
 *
 * Tokens expected to be individual characters/graphemes.
 *
 * @param chars - An array (or a string) of all acceptable characters.
 */
declare function oneOf<TOptions, const TChars extends string | string[]>(chars: TChars): Parser<string, TOptions, GraphemeUnion<TChars>>;

/**
 * Make a parser that matches and returns a character
 * if it is absent in a given character samples string/array.
 *
 * Tokens expected to be individual characters/graphemes.
 *
 * @param chars - An array (or a string) of all characters that are not acceptable.
 */
declare function noneOf<TOptions>(chars: string | string[]): Parser<string, TOptions, string>;

/**
 * Make a parser that uses regular expressions
 * to match/non-match characters belonging to a certain range
 * or having a certain [unicode property](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions/Unicode_Property_Escapes).
 *
 * Provide a `positive` expression to accept only characters that satisfy it.
 * Provide a `negative` expression to reject characters that satisfy it.
 * If both are given a character must match `positive` (when provided) AND must NOT match `negative` (when provided).
 *
 * At least one of the arguments must be provided (throws otherwise).
 *
 * Use `satisfy` from core module instead if you need an arbitrary predicate.
 *
 * Tokens expected to be individual characters / graphemes.
 *
 * @param positive - Regular expression that must match (optional).
 * @param negative - Regular expression that must not match (optional).
 */
declare function charTest<TOptions>(positive: RegExp | undefined, negative?: RegExp): Parser<string, TOptions, string>;

/**
 * Make a parser that looks for the exact match for a given string,
 * returns a match with that string and consumes an according number of tokens.
 *
 * Empty string matches without consuming input.
 *
 * Tokens expected to be individual characters/graphemes.
 *
 * @param str - A string to look for.
 */
declare function str<TOptions, const TString extends string>(str: TString): Parser<string, TOptions, TString>;

/**
 * Make a parser that joins characters/strings
 * from all provided parsers into a single string.
 *
 * Nonmatch is returned if any of parsers didn't match.
 *
 * @param ps - Parsers sequence.
 * Each parser can return a string or an array of strings.
 */
declare function concat<TOptions>(...ps: Parser<string, TOptions, string | string[]>[]): Parser<string, TOptions, string>;

/**
 * Utility function to render a given parser position
 * for error reporting and debug purposes.
 *
 * This is a version specific for char parsers.
 *
 * Note: it will fall back to core version (one token per line)
 * in case any multicharacter tokens are present.
 *
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array.
 * @param contextTokens - How many tokens (characters) around the current one to render.
 * @returns A multiline string.
 *
 * @category Utility functions
 */
declare function parserPosition(data: Data<string, unknown>, i: number, contextTokens?: number): string;

/**
 * Utility function that provides a bit cleaner interface for running a parser.
 *
 * This one throws an error in case parser didn't match
 * OR the match is incomplete (some part of input string left unparsed).
 *
 * Input string is broken down to characters as `[...str]`
 * unless you provide a pre-split array.
 *
 * @param parser - A parser to run.
 * @param str - Input string or an array of graphemes.
 * @param options - Parser options.
 * @returns A matched value.
 *
 * @category Utility functions
 */
declare function parse<TOptions, TValue>(parser: Parser<string, TOptions, TValue>, str: string | string[], options: TOptions): TValue;

/**
 * Utility function that provides a bit cleaner interface
 * for running a parser over a string.
 * Returns `undefined` in case parser did not match.
 *
 * Input string is broken down to characters as `[...str]`
 * unless you provide a pre-split array.
 *
 * Note: this doesn't capture errors thrown during parsing.
 * Nonmatch is considered a part or normal flow.
 * Errors mean unrecoverable state and it's up to client code to decide
 * where to throw errors and how to get back to safe state.
 *
 * @param parser - A parser to run.
 * @param str - Input string or an array of graphemes.
 * @param options - Parser options.
 * @returns A matched value or `undefined` in case of nonmatch.
 *
 * @category Utility functions
 */
declare function tryParse<TOptions, TValue>(parser: Parser<string, TOptions, TValue>, str: string | string[], options: TOptions): TValue | undefined;

/**
 * Utility function that provides a bit cleaner interface
 * for running a {@link Matcher} over a string.
 *
 * Input string is broken down to characters as `[...str]`
 * unless you provide a pre-split array.
 *
 * @param matcher - A matcher to run.
 * @param str - Input string or an array of graphemes.
 * @param options - Parser options.
 * @returns A matched value.
 *
 * @category Utility functions
 */
declare function match<TOptions, TValue>(matcher: Matcher<string, TOptions, TValue>, str: string | string[], options: TOptions): TValue;

export { oneOf as anyOf, char, charTest, concat, match, noneOf, oneOf, parse, parserPosition, str, tryParse };
export type { CharUnion, GraphemeUnion };
