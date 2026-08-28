/**
 * Data that is passed around between composed {@link Parser}s.
 *
 * Intended to be static, although nothing prevents you from
 * accumulating data inside options object - if it makes sense for a particular use case.
 *
 * Keep in mind that it is the same object that is passed around.
 * Anything that requires rollbacks - have to be handled in the parser result value instead.
 *
 * @category Core types
 */
type Data<TToken, TOptions> = {
    /** Tokens array - the subject of parsing. */
    tokens: TToken[];
    /** Parser options object. */
    options: TOptions;
};

/**
 * Matched (successful) result from a {@link Parser}/{@link Matcher}.
 *
 * @category Core types
 */
type Match<TValue> = {
    matched: true;
    /** Parser position after this match. */
    position: number;
    /** Matched value. */
    value: TValue;
};

/**
 * Unsuccessful result from a {@link Parser}.
 *
 * @category Core types
 */
type NonMatch = {
    matched: false;
};

/**
 * Result from a {@link Parser}.
 *
 * @category Core types
 */
type Result<TValue> = Match<TValue> | NonMatch;

/**
 * Parser function.
 * Accepts {@link Data} and token position, returns a {@link Result}.
 *
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array.
 *
 * @category Core types
 */
type Parser<TToken, TOptions, TValue> = (data: Data<TToken, TOptions>, i: number) => Result<TValue>;

/**
 * Special case of {@link Parser} function.
 * Accepts {@link Data} and token position, always returns a {@link Match}.
 *
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array.
 *
 * @category Core types
 */
type Matcher<TToken, TOptions, TValue> = (data: Data<TToken, TOptions>, i: number) => Match<TValue>;

/**
 * Construct a tuple type of a given length.
 *
 * @category Utility types
 */
type TupleOf<TValue, N extends number, R extends unknown[] = []> = number extends N ? TValue[] : R['length'] extends N ? R : TupleOf<TValue, N, [TValue, ...R]>;

/**
 * This overload makes a {@link Matcher} that applies two matchers one after another and joins the results.
 *
 * Use {@link abc} if you want to join 3 different parsers/matchers.
 *
 * Use {@link left} or {@link right} if you want to keep one result and discard another.
 *
 * Use {@link all} if you want a sequence of parsers of arbitrary length (but they have to share a common value type).
 */
declare function ab<TToken, TOptions, TValueA, TValueB, TValue>(
/**
 * First matcher.
 */
pa: Matcher<TToken, TOptions, TValueA>, 
/**
 * Second matcher.
 */
pb: Matcher<TToken, TOptions, TValueB>, 
/**
 * A function to combine values from both matchers.
 *
 * @param va - A value matched by the first matcher.
 * @param vb - A value matched by the second matcher.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before both matchers matched).
 * @param j - Parser position in the tokens array (after both matchers matched).
 */
join: (va: TValueA, vb: TValueB, data: Data<TToken, TOptions>, i: number, j: number) => TValue): Matcher<TToken, TOptions, TValue>;
/**
 * Make a parser that tries two parsers one after another and joins the results.
 *
 * A nonmatch is returned if any of two parsers did not match.
 *
 * Use {@link abc} if you want to join 3 different parsers.
 *
 * Use {@link left} or {@link right} if you want to keep one result and discard another.
 *
 * Use {@link all} if you want a sequence of parsers of arbitrary length (but they have to share a common value type).
 */
declare function ab<TToken, TOptions, TValueA, TValueB, TValue>(
/**
 * First parser.
 */
pa: Parser<TToken, TOptions, TValueA>, 
/**
 * Second parser.
 */
pb: Parser<TToken, TOptions, TValueB>, 
/**
 * A function to combine matched values from both parsers.
 *
 * @param va - A value matched by the first parser.
 * @param vb - A value matched by the second parser.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before both parsers matched).
 * @param j - Parser position in the tokens array (after both parsers matched).
 */
join: (va: TValueA, vb: TValueB, data: Data<TToken, TOptions>, i: number, j: number) => TValue): Parser<TToken, TOptions, TValue>;

/**
 * This overload makes a {@link Matcher} that applies three matchers one after another and joins the results.
 *
 * Use {@link ab} if you want to join just 2 different parsers/matchers.
 *
 * Use {@link middle} if you want to keep only the middle result and discard two others.
 *
 * Use {@link all} if you want a sequence of parsers of arbitrary length (but they have to share a common value type).
 */
declare function abc<TToken, TOptions, TValueA, TValueB, TValueC, TValue>(
/**
 * First matcher.
 */
pa: Matcher<TToken, TOptions, TValueA>, 
/**
 * Second matcher.
 */
pb: Matcher<TToken, TOptions, TValueB>, 
/**
 * Third matcher.
 */
pc: Matcher<TToken, TOptions, TValueC>, 
/**
 * A function to combine matched values from all three matchers.
 *
 * @param va - A value matched by the first matcher.
 * @param vb - A value matched by the second matcher.
 * @param vc - A value matched by the third matcher.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before all three matchers matched).
 * @param j - Parser position in the tokens array (after all three matchers matched).
 */
join: (va: TValueA, vb: TValueB, vc: TValueC, data: Data<TToken, TOptions>, i: number, j: number) => TValue): Matcher<TToken, TOptions, TValue>;
/**
 * Make a parser that tries three parsers one after another and joins the results.
 *
 * A nonmatch is returned if any of three parsers did not match.
 *
 * Use {@link ab} if you want to join just 2 different parsers.
 *
 * Use {@link middle} if you want to keep only the middle result and discard two others.
 *
 * Use {@link all} if you want a sequence of parsers of arbitrary length (but they have to share a common value type).
 */
declare function abc<TToken, TOptions, TValueA, TValueB, TValueC, TValue>(
/**
 * First parser.
 */
pa: Parser<TToken, TOptions, TValueA>, 
/**
 * Second parser.
 */
pb: Parser<TToken, TOptions, TValueB>, 
/**
 * Third parser.
 */
pc: Parser<TToken, TOptions, TValueC>, 
/**
 * A function to combine matched results from all three parsers.
 *
 * @param va - A value matched by the first parser.
 * @param vb - A value matched by the second parser.
 * @param vc - A value matched by the third parser.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before all three parsers matched).
 * @param j - Parser position in the tokens array (after all three parsers matched).
 */
join: (va: TValueA, vb: TValueB, vc: TValueC, data: Data<TToken, TOptions>, i: number, j: number) => TValue): Parser<TToken, TOptions, TValue>;

/**
 * Make a {@link Matcher} that always succeeds with `null` value,
 * and performs an action / side effect without consuming input.
 *
 * Use {@link emit} or {@link make} if you want to produce a result.
 *
 * Use {@link peek} if you want to wrap another parser.
 */
declare function action<TToken, TOptions>(
/**
 * A function to produce a side effect (logging, etc).
 *
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array.
 */
f: (data: Data<TToken, TOptions>, i: number) => void): Matcher<TToken, TOptions, null>;

/**
 * This overload makes a {@link Matcher} that acts like a given one
 * but doesn't consume input.
 *
 * @param p - A matcher.
 */
declare function ahead<TToken, TOptions, TValue>(p: Matcher<TToken, TOptions, TValue>): Matcher<TToken, TOptions, TValue>;
/**
 * Make a parser that acts like a given one but doesn't consume input.
 *
 * @param p - A parser.
 */
declare function ahead<TToken, TOptions, TValue>(p: Parser<TToken, TOptions, TValue>): Parser<TToken, TOptions, TValue>;

/**
 * This overload makes a {@link Matcher} that runs all given matchers one after another
 * and returns all results in an array.
 *
 * @param ps - Matchers to run sequentially.
 */
declare function all<TToken, TOptions, TValue>(...ps: Matcher<TToken, TOptions, TValue>[]): Matcher<TToken, TOptions, TValue[]>;
/**
 * Make a parser that runs all given parsers one after another
 * and returns all results in an array.
 *
 * Nonmatch is returned if any of parsers didn't match.
 *
 * Use {@link ab} or {@link abc} if you need a limited number of parsers of different types.
 *
 * @param ps - Parsers to run sequentially.
 */
declare function all<TToken, TOptions, TValue>(...ps: Parser<TToken, TOptions, TValue>[]): Parser<TToken, TOptions, TValue[]>;

/**
 * Parser that matches any token value, consumes and returns it.
 *
 * Only fails when there are no more tokens.
 *
 * Inverse of {@link end}.
 *
 * Use {@link token} instead if you intend to immediately transform the value.
 *
 * Use {@link satisfy} if there is a test condition but no transformation.
 */
declare function any<TToken, TOptions>(data: Data<TToken, TOptions>, i: number): Result<TToken>;

/**
 * Make a parser that runs a given parser,
 * passes the matched value into a parser-generating function
 * and then runs the returned parser.
 *
 * A nonmatch is returned if any of two parsers did not match.
 *
 * Use {@link condition} if there is no dependency on the value of the first parser.
 *
 * {@link decide} combines parser-generating logic into the first parser.
 *
 * Combine with {@link chainReduce} to get a stack-safe chain of arbitrary length.
 */
declare function chain<TToken, TOptions, TValue1, TValue2>(
/**
 * A parser.
 */
p: Parser<TToken, TOptions, TValue1>, 
/**
 * A function that returns a parser based on the input value.
 *
 * @param v1 - A value from the first parser.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before the first parser matched).
 * @param j - Parser position in the tokens array (after the first parser matched).
 */
f: (v1: TValue1, data: Data<TToken, TOptions>, i: number, j: number) => Parser<TToken, TOptions, TValue2>): Parser<TToken, TOptions, TValue2>;

/**
 * Make a {@link Matcher} that takes 0 or more matches from parsers
 * returned by provided parser-generating function.
 *
 * This is like a combination of {@link chain} and {@link reduceLeft}
 * (except the actual implementation is the other way around).
 *
 * Each next parser is made based on previously accumulated value,
 * parsing continues from left to right until first nonmatch.
 */
declare function chainReduce<TToken, TOptions, TAcc>(
/**
 * Initial value for the accumulator.
 */
acc: TAcc, 
/**
 * A function that returns a parser based on previously accumulated value.
 *
 * @param acc - Accumulated value.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before each parser called).
 */
f: (acc: TAcc, data: Data<TToken, TOptions>, i: number) => Parser<TToken, TOptions, TAcc>): Matcher<TToken, TOptions, TAcc>;

/**
 * This overload makes a {@link Matcher} that chooses between two given matchers based on a condition.
 * This makes possible to allow/disallow a grammar based on context/options.
 *
 * {@link decide} and {@link chain} allow for more complex dynamic rules.
 */
declare function condition<TToken, TOptions, TValueA, TValueB>(
/**
 * Condition.
 *
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before parsing).
 */
cond: (data: Data<TToken, TOptions>, i: number) => boolean, 
/**
 * Matcher to run when the condition is true.
 */
pTrue: Matcher<TToken, TOptions, TValueA>, 
/**
 * Matcher to run when the condition is false.
 */
pFalse: Matcher<TToken, TOptions, TValueB>): Matcher<TToken, TOptions, TValueA | TValueB>;
/**
 * Make a parser that chooses between two given parsers based on a condition.
 * This makes possible to allow/disallow a grammar based on context/options.
 *
 * {@link decide} and {@link chain} allow for more complex dynamic rules.
 */
declare function condition<TToken, TOptions, TValueA, TValueB>(
/**
 * Condition.
 *
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before parsing).
 */
cond: (data: Data<TToken, TOptions>, i: number) => boolean, 
/**
 * Parser to run when the condition is true.
 */
pTrue: Parser<TToken, TOptions, TValueA>, 
/**
 * Parser to run when the condition is false.
 */
pFalse: Parser<TToken, TOptions, TValueB>): Parser<TToken, TOptions, TValueA | TValueB>;

/**
 * This overload makes a {@link Matcher} that runs a given matcher and then a dynamically returned matcher.
 *
 * Compared to {@link condition} this can have any complex logic inside.
 *
 * Prefer to use {@link chain} - it splits the parser generation into a separate function, allowing for more modular code.
 *
 * @param p - A parser that returns another parser as a value.
 * If it consumes the input then the returned parser will be called with the new position.
 */
declare function decide<TToken, TOptions, TValue>(p: Matcher<TToken, TOptions, Matcher<TToken, TOptions, TValue>>): Matcher<TToken, TOptions, TValue>;
/**
 * Make a parser that runs a given parser and then a dynamically returned parser.
 *
 * A nonmatch is returned if any of two parsers did not match.
 *
 * Compared to {@link condition} this can have any complex logic inside.
 *
 * {@link chain} splits the parser generation into a separate function, allowing for more modular code.
 *
 * @param p - A parser that returns another parser as a value.
 * If it consumes the input then the returned parser will be called with the new position.
 */
declare function decide<TToken, TOptions, TValue>(p: Parser<TToken, TOptions, Parser<TToken, TOptions, TValue>>): Parser<TToken, TOptions, TValue>;

/**
 * This overload makes a {@link Matcher} from a parser and a matcher.
 * If the parser matched - return the match,
 * otherwise return the match from the matcher.
 *
 * Can be used to keep the matcher type when you have multiple parsing options
 * and the last one always matches.
 *
 * Combine with {@link choice} if you need multiple alternative parsers of the same value type.
 *
 * Nest calls to have union of more than two different value types derived automatically.
 *
 * Use {@link option} if you just want a constant alternative value
 * without consuming input.
 *
 * @param pa - A parser.
 * @param pb - A matcher that is only called if the parser didn't match.
 */
declare function eitherOr<TToken, TOptions, TValueA, TValueB>(pa: Parser<TToken, TOptions, TValueA>, pb: Matcher<TToken, TOptions, TValueB>): Matcher<TToken, TOptions, TValueA | TValueB>;
/**
 * Make a parser that tries two parsers at the same position
 * and returns the first successful match
 * or a nonmatch if there was none.
 *
 * Use this if you want to combine parsers of different value types.
 *
 * Nest calls to have more than two different value types.
 *
 * Use {@link choice} if you have parsers of the same value type.
 *
 * @param pa - A parser that is tried first.
 * @param pb - A parser that is only tried if the first one didn't match.
 */
declare function eitherOr<TToken, TOptions, TValueA, TValueB>(pa: Parser<TToken, TOptions, TValueA>, pb: Parser<TToken, TOptions, TValueB>): Parser<TToken, TOptions, TValueA | TValueB>;

/**
 * Make a {@link Matcher} that always succeeds with provided value and doesn't consume input.
 *
 * Use {@link make} if you want to make a value dynamically.
 *
 * @param value - The value that is always returned.
 */
declare function emit<TToken, TOptions, const TValue>(value: TValue): Matcher<TToken, TOptions, TValue>;

/**
 * Parser that matches only at the end of input.
 *
 * Inverse of {@link any}.
 */
declare function end<TToken, TOptions>(data: Data<TToken, TOptions>, i: number): Result<true>;

/**
 * Make a {@link Matcher} that throws an error if reached.
 *
 * Use with caution!
 *
 * Use {@link fail} if parser can step back and try a different path.
 *
 * For error recovery you can try to encode erroneous state in an output value instead.
 *
 * @param message - The message or a function to construct it from the current parser state.
 */
declare function error<TToken, TOptions>(message: string | ((data: Data<TToken, TOptions>, i: number) => string)): Matcher<TToken, TOptions, never>;

/**
 * Parser that never matches.
 *
 * Use this as a part of normal flow, when alternative match might still exist.
 *
 * Use {@link error} to interrupt the parsing from unrecoverable situation.
 */
declare function fail<TToken, TOptions>(data: Data<TToken, TOptions>, i: number): NonMatch;

/**
 * This overload makes a {@link Matcher} that tries multiple parsers (last entry is a matcher) at the same position
 * and returns the first successful match.
 *
 * Use {@link last} to try parsers in reverse order.
 *
 * Use {@link longest} to choose the longest match.
 *
 * @param ps - Parsers to try.
 */
declare function first<TToken, TOptions, TValue>(...ps: [...Parser<TToken, TOptions, TValue>[], Matcher<TToken, TOptions, TValue>]): Matcher<TToken, TOptions, TValue>;
/**
 * Make a parser that tries multiple parsers at the same position
 * and returns the first successful match
 * or a nonmatch if there was none.
 *
 * Use {@link last} to try parsers in reverse order.
 *
 * Use {@link longest} to choose the longest match.
 *
 * @param ps - Parsers to try.
 */
declare function first<TToken, TOptions, TValue>(...ps: Parser<TToken, TOptions, TValue>[]): Parser<TToken, TOptions, TValue>;

/**
 * This overload makes a {@link Matcher} that concatenates values
 * from all provided Matchers into a single array while flattening value arrays.
 *
 * Implementation is based on {@link all} and {@link flatten1}.
 *
 * @param ps - Matchers sequence.
 * Each parser can return a match with a value or an array of values.
 */
declare function flatten<TToken, TOptions, TValue>(...ps: Matcher<TToken, TOptions, TValue | TValue[]>[]): Matcher<TToken, TOptions, TValue[]>;
/**
 * Make a parser that concatenates values from all provided parsers
 * into a single array while flattening value arrays.
 *
 * Nonmatch is returned if any of parsers didn't match.
 *
 * Implementation is based on {@link all} and {@link flatten1}.
 *
 * @param ps - Parsers sequence.
 * Each parser can return a match with a value or an array of values.
 */
declare function flatten<TToken, TOptions, TValue>(...ps: Parser<TToken, TOptions, TValue | TValue[]>[]): Parser<TToken, TOptions, TValue[]>;

/**
 * This overload makes a {@link Matcher} that flattens an array
 * of values or value arrays returned by a given Matcher.
 *
 * Implementation is based on {@link map}.
 *
 * @param p - A matcher.
 */
declare function flatten1<TToken, TOptions, TValue>(p: Matcher<TToken, TOptions, (TValue | TValue[])[]>): Matcher<TToken, TOptions, TValue[]>;
/**
 * Make a parser that flattens an array of values or value arrays
 * returned by a given parser.
 *
 * Implementation is based on {@link map}.
 *
 * @param p - A parser.
 */
declare function flatten1<TToken, TOptions, TValue>(p: Parser<TToken, TOptions, (TValue | TValue[])[]>): Parser<TToken, TOptions, TValue[]>;

/**
 * This overload makes a {@link Matcher} that tries multiple parsers (first entry is a matcher) at the same position
 * and returns the first successful match when trying them in reverse (last-to-first) order.
 *
 * Use {@link first} to try parsers in normal order.
 *
 * Use {@link longest} to choose the longest match.
 *
 * @param ps - Parsers to try.
 */
declare function last<TToken, TOptions, TValue>(...ps: [Matcher<TToken, TOptions, TValue>, ...Parser<TToken, TOptions, TValue>[]]): Matcher<TToken, TOptions, TValue>;
/**
 * Make a parser that tries multiple parsers at the same position (in reverse order)
 * and returns the first successful match
 * or a nonmatch if there was none.
 *
 * Use {@link first} to try parsers in normal order.
 *
 * Use {@link longest} to choose the longest match.
 *
 * @param ps - Parsers to try.
 */
declare function last<TToken, TOptions, TValue>(...ps: Parser<TToken, TOptions, TValue>[]): Parser<TToken, TOptions, TValue>;

/**
 * This overload makes a {@link Matcher} that applies two matchers one after another
 * and returns the result from the first one.
 *
 * Implementation is based on {@link ab}.
 *
 * @param pa - First matcher (result is returned).
 * @param pb - Second matcher (result is discarded).
 */
declare function left<TToken, TOptions, TValueA, TValueB>(pa: Matcher<TToken, TOptions, TValueA>, pb: Matcher<TToken, TOptions, TValueB>): Matcher<TToken, TOptions, TValueA>;
/**
 * Make a parser that tries two parsers one after another
 * and returns the result from the first one if both matched.
 *
 * A nonmatch is returned if any of two parsers did not match.
 *
 * Implementation is based on {@link ab}.
 *
 * @param pa - First parser (result is returned).
 * @param pb - Second parser (result is discarded).
 */
declare function left<TToken, TOptions, TValueA, TValueB>(pa: Parser<TToken, TOptions, TValueA>, pb: Parser<TToken, TOptions, TValueB>): Parser<TToken, TOptions, TValueA>;

/**
 * Make a parser that parses one value and any number of following values
 * to combine with the first one in left-to-right (first-to-last) order.
 *
 * Use {@link leftAssoc2} if the grammar has an explicit operator between values.
 *
 * Implementation is based on {@link chain} and {@link reduceLeft}.
 *
 * @param pLeft - A parser for the first value,
 * also defines the result type (accumulator).
 *
 * @param pOper - A parser for each consecutive value.
 * Result type is a transformation operation for the accumulator.
 */
declare function leftAssoc1<TToken, TOptions, TLeft>(pLeft: Parser<TToken, TOptions, TLeft>, pOper: Parser<TToken, TOptions, (x: TLeft) => TLeft>): Parser<TToken, TOptions, TLeft>;

/**
 * Make a parser that parses one value and any number of following operators and values
 * to combine with the first one in left-to-right (first-to-last) order.
 *
 * Use {@link leftAssoc1} if the grammar doesn't have an explicit operator between values.
 *
 * Implementation is based on {@link chain}, {@link reduceLeft} and {@link ab}.
 *
 * @param pLeft - A parser for the first value,
 * also defines the result type (accumulator).
 *
 * @param pOper - A parser for an operator function.
 *
 * @param pRight - A parser for each consecutive value.
 */
declare function leftAssoc2<TToken, TOptions, TLeft, TRight>(pLeft: Parser<TToken, TOptions, TLeft>, pOper: Parser<TToken, TOptions, (x: TLeft, y: TRight) => TLeft>, pRight: Parser<TToken, TOptions, TRight>): Parser<TToken, TOptions, TLeft>;

/**
 * Make a parser that tries all provided parsers at the same position
 * and returns the longest successful match
 * or a nonmatch if there was none.
 *
 * If there are multiple matches of the same maximum length
 * then the first one of them is returned.
 *
 * Use {@link first} to try parsers in normal order and return the first match.
 *
 * Use {@link last} to try parsers in reverse order.
 *
 * @param ps - Parsers to try.
 */
declare function longest<TToken, TOptions, TValue>(...ps: Parser<TToken, TOptions, TValue>[]): Parser<TToken, TOptions, TValue>;

/**
 * Make a {@link Matcher} that always succeeds
 * and makes a value with provided function without consuming input.
 *
 * Use {@link emit} if you want to emit the same value every time.
 *
 * Use {@link action} if you only need a side effect.
 *
 * Use {@link token} if you want to make a value based on an input token.
 */
declare function make<TToken, TOptions, TValue>(
/**
 * A function to get the value.
 *
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array.
 */
f: (data: Data<TToken, TOptions>, i: number) => TValue): Matcher<TToken, TOptions, TValue>;

/**
 * Make a {@link Matcher} that returns all (0 or more) sequential matches of the same given parser.
 *
 * A match with empty array is produced if no single match was found.
 *
 * Use {@link many1} if at least one match is required.
 *
 * Implementation is based on {@link takeWhile}.
 *
 * @param p - A parser to apply repeatedly.
 */
declare function many<TToken, TOptions, TValue>(p: Parser<TToken, TOptions, TValue>): Matcher<TToken, TOptions, TValue[]>;

/**
 * Make a parser that returns all (1 or more) sequential matches of the same parser.
 *
 * A nonmatch is returned if no single match was found.
 *
 * Use {@link many} in case zero matches are allowed.
 *
 * Implementation is based on {@link ab} and {@link many}.
 *
 * @param p - A parser to apply repeatedly.
 */
declare function many1<TToken, TOptions, TValue>(p: Parser<TToken, TOptions, TValue>): Parser<TToken, TOptions, [TValue, ...TValue[]]>;

/**
 * This overload makes a new {@link Matcher} that
 * transforms the matched value from a given Matcher.
 *
 * Use {@link mapR} if some matched values can't be mapped.
 *
 * Use {@link ab} to map over values of two consecutive parsers.
 *
 * Use {@link abc} to map over values of three consecutive parsers.
 */
declare function map<TToken, TOptions, TValue1, TValue2>(
/**
 * A base matcher.
 */
p: Matcher<TToken, TOptions, TValue1>, 
/**
 * A function that modifies the matched value.
 *
 * @param v - A value matched by the base parser.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before the first parser matched).
 * @param j - Parser position in the tokens array (after the first parser matched).
 */
mapper: (v: TValue1, data: Data<TToken, TOptions>, i: number, j: number) => TValue2): Matcher<TToken, TOptions, TValue2>;
/**
 * Make a new parser that transforms the matched value from a given parser.
 *
 * Use {@link mapR} if some matched values can't be mapped.
 */
declare function map<TToken, TOptions, TValue1, TValue2>(
/**
 * A base parser.
 */
p: Parser<TToken, TOptions, TValue1>, 
/**
 * A function that modifies the matched value.
 *
 * @param v - A value matched by the base parser.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before the first parser matched).
 * @param j - Parser position in the tokens array (after the first parser matched).
 */
mapper: (v: TValue1, data: Data<TToken, TOptions>, i: number, j: number) => TValue2): Parser<TToken, TOptions, TValue2>;

/**
 * Make a new parser that transforms the match from a given parser to any {@link Result}.
 *
 * This version can discard a {@link Match} - return a {@link NonMatch} instead.
 *
 * Note: pay attention to the return type and indices.
 *
 * Use {@link map} if mapping exists for all matched values.
 *
 * Use {@link filter} for discarding some matches based on a condition, without modifying.
 */
declare function mapR<TToken, TOptions, TValue1, TValue2>(
/**
 * A base parser.
 */
p: Parser<TToken, TOptions, TValue1>, 
/**
 * A function that modifies the match.
 *
 * @param m - A {@link Match} object from the base parser (contains the value and the position after the match).
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before the first parser matched).
 * @returns A transformed {@link Result} object - either {@link Match} or {@link NonMatch}.
 */
mapper: (m: Match<TValue1>, data: Data<TToken, TOptions>, i: number) => Result<TValue2>): Parser<TToken, TOptions, TValue2>;

/**
 * This overload makes a {@link Matcher} that applies three matchers one after another
 * and returns the middle result.
 *
 * Implementation is based on {@link abc}.
 *
 * @param pa - First matcher (result is discarded).
 * @param pb - Second matcher (result is returned).
 * @param pc - Third matcher (result is discarded).
 */
declare function middle<TToken, TOptions, TValueA, TValueB, TValueC>(pa: Matcher<TToken, TOptions, TValueA>, pb: Matcher<TToken, TOptions, TValueB>, pc: Matcher<TToken, TOptions, TValueC>): Matcher<TToken, TOptions, TValueB>;
/**
 * Make a parser that tries three parsers one after another
 * and returns the middle result if all three matched.
 *
 * A nonmatch is returned if any of three parsers did not match.
 *
 * Implementation is based on {@link abc}.
 *
 * @param pa - First parser (result is discarded).
 * @param pb - Second parser (result is returned).
 * @param pc - Third parser (result is discarded).
 */
declare function middle<TToken, TOptions, TValueA, TValueB, TValueC>(pa: Parser<TToken, TOptions, TValueA>, pb: Parser<TToken, TOptions, TValueB>, pc: Parser<TToken, TOptions, TValueC>): Parser<TToken, TOptions, TValueB>;

/**
 * Make a parser that returns a Match without consuming input
 * in case the inner parser didn't match
 * and a NonMatch in case the inner parser matched.
 *
 * @param p - A parser.
 */
declare function not<TToken, TOptions, TValue>(p: Parser<TToken, TOptions, TValue>): Parser<TToken, TOptions, true>;

/**
 * Make a {@link Matcher} that returns either a match from a given parser
 * or a match with the default value (without consuming input in that case).
 *
 * Use {@link eitherOr} if you want to provide a {@link Matcher}
 * instead of a constant default value.
 *
 * @param p - A parser.
 * @param def - Default value to be returned in case parser didn't match.
 */
declare function option<TToken, TOptions, TValue, const TDefault>(p: Parser<TToken, TOptions, TValue>, def: TDefault): Matcher<TToken, TOptions, TValue | TDefault>;

/**
 * This overload adds a side effect to a {@link Matcher} without changing it's result.
 *
 * Use {@link action} if there is nothing to wrap and you need a non-consuming parser instead.
 */
declare function peek<TToken, TOptions, TValue>(
/**
 * A matcher.
 */
p: Matcher<TToken, TOptions, TValue>, 
/**
 * A function to produce a side effect (logging, etc).
 *
 * @param r - A {@link Result} object after running the base parser.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before the first parser matched).
 */
f: (r: Match<TValue>, data: Data<TToken, TOptions>, i: number) => void): Matcher<TToken, TOptions, TValue>;
/**
 * Add a side effect to a parser without changing it's result.
 *
 * Use {@link action} if there is nothing to wrap and you need a non-consuming parser instead.
 */
declare function peek<TToken, TOptions, TValue>(
/**
 * A parser.
 */
p: Parser<TToken, TOptions, TValue>, 
/**
 * A function to produce a side effect (logging, etc).
 *
 * @param r - A {@link Result} object after running the base parser.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before the first parser matched).
 */
f: (r: Result<TValue>, data: Data<TToken, TOptions>, i: number) => void): Parser<TToken, TOptions, TValue>;

/**
 * A wrapper that helps to create recursive parsers -
 * allows to refer to a parser defined later in the code.
 *
 * Alternatively, parsers defined/wrapped as functions
 * (rather than constants obtained by composition)
 * don't need this.
 *
 * This overload is for {@link Matcher}s.
 *
 * @param f - A function that returns a matcher.
 * @returns A parser wrapped into a function.
 */
declare function recursive<TToken, TOptions, TValue>(f: () => Matcher<TToken, TOptions, TValue>): Matcher<TToken, TOptions, TValue>;
/**
 * A wrapper that helps to create recursive parsers -
 * allows to refer to a parser defined later in the code.
 *
 * Alternatively, parsers defined/wrapped as functions
 * (rather than constants obtained by composition)
 * don't need this.
 *
 * @param f - A function that returns a parser.
 * @returns A parser wrapped into a function.
 */
declare function recursive<TToken, TOptions, TValue>(f: () => Parser<TToken, TOptions, TValue>): Parser<TToken, TOptions, TValue>;

/**
 * Make a {@link Matcher} that takes 0 or more matches from the same parser
 * and reduces them into one value in left-to-right (first-to-last) order.
 *
 * Note: accumulator is the left (first) argument.
 *
 * Use {@link leftAssoc1} if you have an initial value to be parsed first.
 *
 * Implementation is based on {@link chainReduce} and {@link map}.
 */
declare function reduceLeft<TToken, TOptions, TAcc, TValue>(
/**
 * Initial value for the accumulator.
 */
acc: TAcc, 
/**
 * Parser for each next value.
 */
p: Parser<TToken, TOptions, TValue>, 
/**
 * Function to combine the accumulator and each parsed value.
 *
 * @param acc - Accumulated value.
 * @param v - Value from each successful parsing.
 * @param data - Data object (tokens and options).
 * @param i - Position before current match.
 * @param j - Position after current match.
 */
reducer: (acc: TAcc, v: TValue, data: Data<TToken, TOptions>, i: number, j: number) => TAcc): Matcher<TToken, TOptions, TAcc>;

/**
 * Make a {@link Matcher} that takes 0 or more matches from the same parser
 * and reduces them into one value in right-to-left (last-to-first) order.
 *
 * Note: accumulator is the right (second) argument.
 *
 * Use {@link rightAssoc1} if you have an initial value to be parsed after all matches.
 *
 * Implementation is based on {@link many} and {@link map}.
 */
declare function reduceRight<TToken, TOptions, TValue, TAcc>(
/**
 * Parser for each next value.
 */
p: Parser<TToken, TOptions, TValue>, 
/**
 * Initial value for the accumulator.
 */
acc: TAcc, 
/**
 * Function to combine the accumulator and each parsed value.
 *
 * @param v - Value from each successful parsing.
 * @param acc - Accumulated value.
 * @param data - Data object (tokens and options).
 * @param i - Position before all successful parsings.
 * @param j - Position after all successful parsings.
 */
reducer: (v: TValue, acc: TAcc, data: Data<TToken, TOptions>, i: number, j: number) => TAcc): Matcher<TToken, TOptions, TAcc>;

/**
 * This overload makes a {@link Matcher} that applies two matchers one after another
 * and returns the result from the second one.
 *
 * Implementation is based on {@link ab}.
 *
 * @param pa - First matcher (result is discarded).
 * @param pb - Second matcher (result is returned).
 */
declare function right<TToken, TOptions, TValueA, TValueB>(pa: Matcher<TToken, TOptions, TValueA>, pb: Matcher<TToken, TOptions, TValueB>): Matcher<TToken, TOptions, TValueB>;
/**
 * Make a parser that tries two parsers one after another
 * and returns the result from the second one if both matched.
 *
 * A nonmatch is returned if any of two parsers did not match.
 *
 * Implementation is based on {@link ab}.
 *
 * @param pa - First parser (result is discarded).
 * @param pb - Second parser (result is returned).
 */
declare function right<TToken, TOptions, TValueA, TValueB>(pa: Parser<TToken, TOptions, TValueA>, pb: Parser<TToken, TOptions, TValueB>): Parser<TToken, TOptions, TValueB>;

/**
 * Make a parser that parses any number of values and then one extra value
 * to combine in right-to-left (last-to-first) order.
 *
 * Note: This can fail if `pOper` and `pRight` can consume same tokens.
 * You'll have to make an {@link ahead} guard to prevent it from consuming the last token.
 *
 * Use {@link rightAssoc2} if the grammar has an explicit operator between values.
 *
 * Implementation is based on {@link ab} and {@link reduceRight}.
 *
 * @param pOper - A parser for each consecutive value.
 * Result type is a transformation operation for the accumulator.
 *
 * @param pRight - A parser for the last value,
 * also defines the result type (accumulator).
 */
declare function rightAssoc1<TToken, TOptions, TRight>(pOper: Parser<TToken, TOptions, (y: TRight) => TRight>, pRight: Parser<TToken, TOptions, TRight>): Parser<TToken, TOptions, TRight>;

/**
 * Make a parser that parses any number of values and operators, then one extra value
 * to combine in right-to-left (last-to-first) order.
 *
 * Use {@link rightAssoc1} if the grammar doesn't have an explicit operator between values.
 *
 * Implementation is based on {@link ab} and {@link reduceRight}.
 *
 * @param pLeft - A parser for each consecutive value.
 *
 * @param pOper - A parser for an operator function.
 *
 * @param pRight - A parser for the last value,
 * also defines the result type (accumulator).
 */
declare function rightAssoc2<TToken, TOptions, TLeft, TRight>(pLeft: Parser<TToken, TOptions, TLeft>, pOper: Parser<TToken, TOptions, (x: TLeft, y: TRight) => TRight>, pRight: Parser<TToken, TOptions, TRight>): Parser<TToken, TOptions, TRight>;

/**
 * Make a parser that tests a token with a given predicate and returns the token value unchanged.
 *
 * This overload uses a type guard predicate to narrow the token/value type on success.
 *
 * Use {@link token} instead if you want to transform the value.
 *
 * Use {@link filter} for testing a match from another parser instead of a token directly.
 */
declare function satisfy<TToken1, TOptions, TToken2 extends TToken1>(
/**
 * A test condition/predicate.
 *
 * @param token - A token at the parser position.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (points at the same token).
 */
test: (token: TToken1, data: Data<TToken1, TOptions>, i: number) => token is TToken2): Parser<TToken1, TOptions, TToken2>;
/**
 * Make a parser that tests a token with a given predicate and returns the token value unchanged.
 *
 * Use {@link token} instead if you want to transform the value.
 *
 * Use {@link filter} for testing a match from another parser instead of a token directly.
 */
declare function satisfy<TToken, TOptions>(
/**
 * A test condition/predicate.
 *
 * @param token - A token at the parser position.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (points at the same token).
 */
test: (token: TToken, data: Data<TToken, TOptions>, i: number) => boolean): Parser<TToken, TOptions, TToken>;

/**
 * Make a {@link Matcher} that matches 0 or more values interleaved with separators.
 *
 * A match with an empty array is returned if no single value was matched.
 *
 * Implementation is based on {@link eitherOr} , {@link sepBy1} and {@link emit}.
 *
 * @param pValue - A parser for values.
 * @param pSep - A parser for separators.
 */
declare function sepBy<TToken, TOptions, TValue, TSep>(pValue: Parser<TToken, TOptions, TValue>, pSep: Parser<TToken, TOptions, TSep>): Matcher<TToken, TOptions, TValue[]>;

/**
 * Make a parser that matches 1 or more values interleaved with separators.
 *
 * A nonmatch is returned if no single value was matched.
 *
 * Implementation is based on {@link ab}, {@link many} and {@link right}.
 *
 * @param pValue - A parser for values.
 * @param pSep - A parser for separators.
 */
declare function sepBy1<TToken, TOptions, TValue, TSep>(pValue: Parser<TToken, TOptions, TValue>, pSep: Parser<TToken, TOptions, TSep>): Parser<TToken, TOptions, [TValue, ...TValue[]]>;

/**
 * This overload makes a {@link Matcher} that runs all given matchers in sequence
 * and discards (skips) all results (Returns a match with a dummy value).
 *
 * Implementation is based on {@link all} and {@link map}.
 *
 * This function only exists to make the intent clear.
 * Use in combination with {@link left}, {@link right} or other combinators
 * to make the dummy result disappear.
 *
 * @param ps - Parsers to run sequentially.
 */
declare function skip<TToken, TOptions>(...ps: Matcher<TToken, TOptions, unknown>[]): Matcher<TToken, TOptions, unknown>;
/**
 * Make a parser that runs all given parsers in sequence
 * and discards (skips) all results (Returns a match with a dummy value).
 *
 * Nonmatch is returned if any of parsers didn't match.
 *
 * Implementation is based on {@link all} and {@link map}.
 *
 * This function only exists to make the intent clear.
 * Use in combination with {@link left}, {@link right} or other combinators
 * to make the dummy result disappear.
 *
 * @param ps - Parsers to run sequentially.
 */
declare function skip<TToken, TOptions>(...ps: Parser<TToken, TOptions, unknown>[]): Parser<TToken, TOptions, unknown>;

/**
 * Parser that matches only at the beginning and doesn't consume input.
 */
declare function start<TToken, TOptions>(data: Data<TToken, TOptions>, i: number): Result<true>;

/**
 * Make a parser that expects at least `min` and at most `max` sequential matches of the same parser.
 *
 * A nonmatch is returned if there are less than `min` matches.
 *
 * Does not consume more than `max` matches.
 *
 * Equivalent to {@link takeN} when `min` and `max` set to the same value - prefer using that.
 *
 * Equivalent to {@link many} when neither `min` nor `max` is set - prefer using that.
 *
 * @param p - A parser.
 * @param min - Minimum number of matches to take.
 * @param max - Maximum number of matches to take.
 */
declare function takeMinMax<TToken, TOptions, TValue>(p: Parser<TToken, TOptions, TValue>, min: number | undefined, max: number | undefined): Parser<TToken, TOptions, TValue[]>;

/**
 * Make a parser that expects exactly `n` sequential matches of the same parser.
 *
 * A nonmatch is returned if there are not enough matches.
 *
 * Use {@link takeMinMax} if the number of matches is defined by a range.
 *
 * @param p - A parser.
 * @param n - Number of matches to take.
 */
declare function takeN<TToken, TOptions, TValue, N extends number>(p: Parser<TToken, TOptions, TValue>, n: N): Parser<TToken, TOptions, TupleOf<TValue, N>>;

/**
 * Make a {@link Matcher} that returns all (0 or more)
 * sequential matches of the same given parser *while* the test function
 * equates to `false` (that is *until* it equates to `true` for the first time).
 *
 * Use {@link many} if there is no stop condition.
 *
 * Use {@link takeUntilP} if the stop condition is expressed as a parser.
 *
 * Implementation is based on {@link takeWhile}.
 */
declare function takeUntil<TToken, TOptions, TValue>(
/**
 * A parser.
 */
p: Parser<TToken, TOptions, TValue>, 
/**
 * Matched results are accumulated *until* the result of this function is `true`.
 *
 * @param value - Current value matched by the parser.
 * @param n - Number of matches so far (including the current value).
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before the current value matched).
 * @param j - Parser position in the tokens array (after the current value matched).
 */
test: (value: TValue, n: number, data: Data<TToken, TOptions>, i: number, j: number) => boolean): Matcher<TToken, TOptions, TValue[]>;

/**
 * Make a {@link Matcher} that returns all (0 or more)
 * sequential matches of the first parser *while* the second parser does not match
 * (that is *until* the second parser matches).
 *
 * Use {@link takeUntil} if the stop condition is based on the parsed value.
 *
 * Implementation is based on {@link takeWhile}.
 *
 * @param pValue - A parser that produces result values.
 * @param pTest - A parser that serves as a stop condition.
 */
declare function takeUntilP<TToken, TOptions, TValue>(pValue: Parser<TToken, TOptions, TValue>, pTest: Parser<TToken, TOptions, unknown>): Matcher<TToken, TOptions, TValue[]>;

/**
 * This overload makes a {@link Matcher} that returns all (0 or more)
 * sequential matches of the same given parser *while* the type guard test passes.
 *
 * Use {@link many} if there is no stop condition.
 *
 * Use {@link takeWhileP} if the stop condition is expressed as a parser.
 *
 * Use {@link filter} to take one match or a non-match based on a test function (can also be a type guard).
 */
declare function takeWhile<TToken, TOptions, TValue1, TValue2 extends TValue1>(
/**
 * A parser.
 */
p: Parser<TToken, TOptions, TValue1>, 
/**
 * Matched results are accumulated *while* this type guard test passes.
 *
 * @param value - Current value matched by the parser.
 * @param n - Number of matches so far (including the current value).
 * @param data - Data object (tokens and options).
 * @param i - Position before the current value matched.
 * @param j - Position after the current value matched.
 */
test: (value: TValue1, n: number, data: Data<TToken, TOptions>, i: number, j: number) => value is TValue2): Matcher<TToken, TOptions, TValue2[]>;
/**
 * Make a {@link Matcher} that returns all (0 or more)
 * sequential matches of the same given parser *while* the test function
 * equates to `true`.
 *
 * Use {@link many} if there is no stop condition.
 *
 * Use {@link takeWhileP} if the stop condition is expressed as a parser.
 *
 * Use {@link filter} to take one match or a non-match based on a test function.
 */
declare function takeWhile<TToken, TOptions, TValue>(
/**
 * A parser.
 */
p: Parser<TToken, TOptions, TValue>, 
/**
 * Matched results are accumulated *while* the result of this function is `true`.
 *
 * @param value - Current value matched by the parser.
 * @param n - Number of matches so far (including the current value).
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (before the current value matched).
 * @param j - Parser position in the tokens array (after the current value matched).
 */
test: (value: TValue, n: number, data: Data<TToken, TOptions>, i: number, j: number) => boolean): Matcher<TToken, TOptions, TValue[]>;

/**
 * Make a {@link Matcher} that returns all (0 or more)
 * sequential matches of the first parser *while* the second parser also matches.
 *
 * Use {@link takeWhile} if the stop condition is based on the parsed value.
 *
 * Implementation is based on {@link takeWhile}.
 *
 * @param pValue - A parser that produces result values.
 * @param pTest - A parser that serves as a stop condition.
 */
declare function takeWhileP<TToken, TOptions, TValue>(pValue: Parser<TToken, TOptions, TValue>, pTest: Parser<TToken, TOptions, unknown>): Matcher<TToken, TOptions, TValue[]>;

/**
 * Make a parser based on a token-to-value function.
 *
 * Nonmatch is produced if `undefined` value is returned by a function or if there are no tokens left.
 *
 * Use {@link make} if you want to produce a value without consuming a token.
 *
 * You can use {@link satisfy} if you just want to test but not transform the value.
 */
declare function token<TToken, TOptions, TValue>(
/**
 * Function that either transforms a token to a result value or returns `undefined`.
 *
 * @param token - A token at the parser position.
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (points at the same token).
 */
onToken: (token: TToken, data: Data<TToken, TOptions>, i: number) => TValue | undefined, 
/**
 * Optional function to be called if there are no tokens left. It can be used to throw an error when required token is missing.
 *
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array (naturally points after the end of array).
 */
onEnd?: (data: Data<TToken, TOptions>, i: number) => void): Parser<TToken, TOptions, TValue>;

/**
 * Make a new parser that keeps a match from a given parser only if a predicate passes;
 * otherwise discards it (returns a NonMatch).
 *
 * This overload uses a type guard predicate to narrow the value type on success.
 *
 * Use {@link satisfy} to test a token at the current position instead of a value matched by another parser.
 *
 * Use {@link takeWhile} to accumulate 0 or more matches while predicate holds.
 *
 * {@link mapR} can be used if you need to filter and transform matches at the same time.
 * But it is better to use `filter` and {@link map} instead in most cases.
 */
declare function filter<TToken, TOptions, TValue1, TValue2 extends TValue1>(
/**
 * A base parser.
 */
p: Parser<TToken, TOptions, TValue1>, 
/**
 * A type-guard predicate applied to the matched value to decide whether to keep it.
 *
 * @param value - Value matched by the base parser.
 * @param data - Data object (tokens and options).
 * @param i - Parser position before the base parser matched.
 * @param j - Parser position after the base parser matched.
 */
test: (value: TValue1, data: Data<TToken, TOptions>, i: number, j: number) => value is TValue2): Parser<TToken, TOptions, TValue2>;
/**
 * Make a new parser that keeps a match from a given parser only if a predicate passes;
 * otherwise discards it (returns a NonMatch).
 *
 * Use {@link satisfy} to test a token at the current position instead of a value matched by another parser.
 *
 * Use {@link takeWhile} to accumulate 0 or more matches while predicate holds.
 *
 * {@link mapR} can be used if you need to filter and transform matches at the same time.
 * But it is better to use `filter` and {@link map} instead in most cases.
 */
declare function filter<TToken, TOptions, TValue>(
/**
 * A base parser.
 */
p: Parser<TToken, TOptions, TValue>, 
/**
 * A predicate applied to the matched value to decide whether to keep it.
 *
 * @param value - Value matched by the base parser.
 * @param data - Data object (tokens and options).
 * @param i - Parser position before the base parser matched.
 * @param j - Parser position after the base parser matched.
 */
test: (value: TValue, data: Data<TToken, TOptions>, i: number, j: number) => boolean): Parser<TToken, TOptions, TValue>;

/**
 * Utility function returning the number of tokens
 * that are not yet parsed (current token included).
 *
 * Useful when creating custom base parsers.
 *
 * Note: Can return a negative value if the supplied position
 * goes beyond the tokens array length for whatever reason.
 *
 * @param data - Data.
 * @param i - Current position.
 *
 * @category Utility functions
 */
declare function remainingTokensNumber<TToken>(data: Data<TToken, unknown>, i: number): number;

/**
 * Utility function to render a given parser position
 * for error reporting and debug purposes.
 *
 * @param data - Data object (tokens and options).
 * @param i - Parser position in the tokens array.
 * @param formatToken - A function to stringify a token.
 * @param contextTokens - How many tokens around the current one to render.
 * @returns A multiline string.
 *
 * @category Utility functions
 */
declare function parserPosition<TToken>(data: Data<TToken, unknown>, i: number, formatToken: (t: TToken) => string, contextTokens?: number): string;

/**
 * Utility function that provides a bit cleaner interface for running a parser.
 *
 * This one throws an error in case parser didn't match
 * OR the match is incomplete (some part of tokens array left unparsed).
 *
 * @param parser - A parser to run.
 * @param tokens - Input tokens.
 * @param options - Parser options.
 * @param formatToken - A function to stringify a token
 * (Defaults to `JSON.stringify`. For incomplete match error message).
 *
 * @returns A matched value.
 *
 * @category Utility functions
 */
declare function parse<TToken, TOptions, TValue>(parser: Parser<TToken, TOptions, TValue>, tokens: TToken[], options: TOptions, formatToken?: (t: TToken) => string): TValue;

/**
 * Utility function that provides a bit cleaner interface for running a parser.
 * Returns `undefined` in case parser did not match.
 *
 * Note: this doesn't capture errors thrown during parsing.
 * Nonmatch is considered a part or normal flow.
 * Errors mean unrecoverable state and it's up to client code to decide
 * where to throw errors and how to get back to safe state.
 *
 * @param parser - A parser to run.
 * @param tokens - Input tokens.
 * @param options - Parser options.
 * @returns A matched value or `undefined` in case of nonmatch.
 *
 * @category Utility functions
 */
declare function tryParse<TToken, TOptions, TValue>(parser: Parser<TToken, TOptions, TValue>, tokens: TToken[], options: TOptions): TValue | undefined;

/**
 * Utility function that provides a bit cleaner interface for running a {@link Matcher}.
 *
 * @param matcher - A matcher to run.
 * @param tokens - Input tokens.
 * @param options - Parser options.
 * @returns A matched value.
 *
 * @category Utility functions
 */
declare function match<TToken, TOptions, TValue>(matcher: Matcher<TToken, TOptions, TValue>, tokens: TToken[], options: TOptions): TValue;

export { ab, abc, action, ahead, all, all as and, any, middle as between, chain, chainReduce, first as choice, condition, decide, skip as discard, eitherOr, emit, end, end as eof, error, fail, filter, first, flatten, flatten1, filter as guard, last, left, leftAssoc1, leftAssoc2, longest, ahead as lookAhead, make, many, many1, map, mapR as map1, mapR, match, middle, not, emit as of, option, first as or, eitherOr as otherwise, parse, parserPosition, peek, recursive, reduceLeft, reduceRight, filter as refine, remainingTokensNumber, right, rightAssoc1, rightAssoc2, satisfy, sepBy, sepBy1, skip, many1 as some, start, takeMinMax, takeN, takeUntil, takeUntilP, takeWhile, takeWhileP, token, tryParse };
export type { Data, Match, Matcher, NonMatch, Parser, Result, TupleOf };
