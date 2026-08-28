# peberminta

![lint status badge](https://github.com/mxxii/peberminta/workflows/lint/badge.svg)
![test status badge](https://github.com/mxxii/peberminta/workflows/test/badge.svg)
![test coverage badge](https://img.shields.io/nycrc/mxxii/peberminta?config=.c8rc.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/mxxii/peberminta/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/peberminta?logo=npm)](https://www.npmjs.com/package/peberminta)
[![npm](https://img.shields.io/npm/dw/peberminta?color=informational&logo=npm)](https://www.npmjs.com/package/peberminta)
[![deno](https://img.shields.io/badge/deno.land%2Fx%2F-peberminta-informational?logo=deno)](https://deno.land/x/peberminta)

Simple, transparent parser combinators toolkit that supports tokens of any type.

For when you wanna do weird things with parsers.


## Features

- **Well typed** - written in TypeScript and with a lot of attention to keep types well defined.

- **Highly generic** - no constraints on tokens, options (additional state data) and output types. Core module has not a single mention of strings as a part of normal flow. Some string-specific building blocks can be loaded from a separate module in case you need them.

- **Transparent**. Built on a very simple base idea - just a few type aliases. Whole parser state is accessible at any time.

- **Lightweight**. Zero dependencies. Just type aliases and functions.

- **Batteries included** - comes with a pretty big set of building blocks.

- **Easy to extend** - just follow the convention defined by type aliases when making your own building blocks. *(And maybe let me know what you think can be universally useful to be included in the package itself.)*

- **Easy to make configurable parsers**. Rather than dynamically composing parsers based on options or manually weaving options into a dynamic parser state, this package offers a standard way to treat options as a part of static data and access them at any moment for course correction.

- **Well tested** - comes with tests for everything including examples.

- **Practicality over "purity"**. To be understandable and self-consistent is more important than to follow an established encoding of abstract ideas. More on this below.

- **No streaming** - accepts a fixed array of tokens. It is simple, whole input can be accessed at any time if needed. More on this below.

- **Bring your own lexer/tokenizer** - if you need it. It doesn't matter how tokens are made - this package can consume anything you can type. I have a lexer as well, called [leac](https://github.com/mxxii/leac), and it is used in some examples, but there is nothing special about it to make it the best match (well, maybe the fact it is written in TypeScript, has equal level of maintenance and is made with arrays instead of iterators in mind as well).


## Changelog

Available here: [CHANGELOG.md](https://github.com/mxxii/peberminta/blob/main/CHANGELOG.md)


## Install

### Node

```shell
> npm i peberminta
```

```ts
import * as p from 'peberminta';
import * as pc from 'peberminta/char';
```

### Deno

```ts
import * as p from 'https://deno.land/x/peberminta@.../core.ts';
import * as pc from 'https://deno.land/x/peberminta@.../char.ts';
```


## Examples

- [JSON formal](https://github.com/mxxii/peberminta/blob/main/examples/json-formal.ts);
- [JSON lazy](https://github.com/mxxii/peberminta/blob/main/examples/json-lazy.ts) (with lexer);
- [McKeeman Form](https://github.com/mxxii/peberminta/blob/main/examples/mckeeman-form.ts) (<https://www.crockford.com/mckeeman.html>);
- [CSV](https://github.com/mxxii/peberminta/blob/main/examples/csv.ts);
- [Hex Color](https://github.com/mxxii/peberminta/blob/main/examples/hexColor.ts);
- [Calc](https://github.com/mxxii/peberminta/blob/main/examples/calc.ts) (with lexer);
- [Brainfuck](https://github.com/mxxii/peberminta/blob/main/examples/bf1.ts) (and [another implementation](https://github.com/mxxii/peberminta/blob/main/examples/bf2.ts));
- [Non-decreasing sequences](https://github.com/mxxii/peberminta/blob/main/examples/nonDec.ts);
- *feel free to PR or request interesting compact grammar examples.*

### Published packages using `peberminta`

- [aspargvs](https://github.com/mxxii/aspargvs) - arg parser, CLI wrapper
- [parseley](https://github.com/mxxii/parseley) - CSS selectors parser


## API

Detailed API documentation with navigation and search:

- [core module](https://mxxii.github.io/peberminta/modules/core.html);
- [char module](https://mxxii.github.io/peberminta/modules/char.html).

### Convention

Whole package is built around these type aliases:

```typescript
export type Data<TToken,TOptions> = {
  tokens: TToken[],
  options: TOptions
};

export type Parser<TToken,TOptions,TValue> =
  (data: Data<TToken,TOptions>, i: number) => Result<TValue>;

export type Matcher<TToken,TOptions,TValue> =
  (data: Data<TToken,TOptions>, i: number) => Match<TValue>;

export type Result<TValue> = Match<TValue> | NonMatch;

export type Match<TValue> = {
  matched: true,
  position: number,
  value: TValue
};

export type NonMatch = {
  matched: false
};
```

- **Data** object holds tokens array and possibly an options object - it's just a container for all static data used by a parser. Parser position, on the other hand, has it's own life cycle and passed around separately.

- A **Parser** is a function that accepts Data object and a parser position, looks into the tokens array at the given position and returns either a Match with a parsed value (use `null` if there is no value) and a new position or a NonMatch.

- A **Matcher** is a special case of Parser that never fails and always returns a Match.

- **Result** object from a Parser can be either a Match or a NonMatch.

- **Match** is a result of successful parsing - it contains a parsed value and a new parser position.

- **NonMatch** is a result of unsuccessful parsing. It doesn't have any data attached to it.

- **TToken** can be any type.

- **TOptions** can be any type. Use it to make your parser customizable. Or set it as `undefined` and type as `unknown` if not needed.

### Building blocks

#### Core blocks

<div class="headlessTable">

| <!-- -->                                                                          | <!-- -->                                                                          | <!-- -->                                                                        | <!-- -->                                                                          |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [ab](https://mxxii.github.io/peberminta/functions/core.ab.html)                   | [abc](https://mxxii.github.io/peberminta/functions/core.abc.html)                 | [action](https://mxxii.github.io/peberminta/functions/core.action.html)         | [ahead](https://mxxii.github.io/peberminta/functions/core.ahead.html)             |
| [all](https://mxxii.github.io/peberminta/functions/core.all.html)                 | _[and](https://mxxii.github.io/peberminta/modules/core.html#and)_                 | [any](https://mxxii.github.io/peberminta/functions/core.any.html)               | _[between](https://mxxii.github.io/peberminta/modules/core.html#between)_         |
| [chain](https://mxxii.github.io/peberminta/functions/core.chain.html)             | [chainReduce](https://mxxii.github.io/peberminta/functions/core.chainReduce.html) | _[choice](https://mxxii.github.io/peberminta/modules/core.html#choice)_         | [condition](https://mxxii.github.io/peberminta/functions/core.condition.html)     |
| [decide](https://mxxii.github.io/peberminta/functions/core.decide.html)           | _[discard](https://mxxii.github.io/peberminta/modules/core.html#discard)_         | [eitherOr](https://mxxii.github.io/peberminta/functions/core.eitherOr.html)     | [emit](https://mxxii.github.io/peberminta/functions/core.emit.html)               |
| [end](https://mxxii.github.io/peberminta/functions/core.end.html)                 | _[eof](https://mxxii.github.io/peberminta/modules/core.html#eof)_                 | [error](https://mxxii.github.io/peberminta/functions/core.error.html)           | [fail](https://mxxii.github.io/peberminta/functions/core.fail.html)               |
| [filter](https://mxxii.github.io/peberminta/functions/core.filter.html)           | [first](https://mxxii.github.io/peberminta/functions/core.first.html)             | [flatten](https://mxxii.github.io/peberminta/functions/core.flatten.html)       | [flatten1](https://mxxii.github.io/peberminta/functions/core.flatten1.html)       |
| _[guard](https://mxxii.github.io/peberminta/modules/core.html#guard)_             | [last](https://mxxii.github.io/peberminta/functions/core.last.html)               | [left](https://mxxii.github.io/peberminta/functions/core.left.html)             | [leftAssoc1](https://mxxii.github.io/peberminta/functions/core.leftAssoc1.html)   |
| [leftAssoc2](https://mxxii.github.io/peberminta/functions/core.leftAssoc2.html)   | [longest](https://mxxii.github.io/peberminta/functions/core.longest.html)         | _[lookAhead](https://mxxii.github.io/peberminta/modules/core.html#lookAhead)_   | [make](https://mxxii.github.io/peberminta/functions/core.make.html)               |
| [many](https://mxxii.github.io/peberminta/functions/core.many.html)               | [many1](https://mxxii.github.io/peberminta/functions/core.many1.html)             | [map](https://mxxii.github.io/peberminta/functions/core.map.html)               | [mapR](https://mxxii.github.io/peberminta/functions/core.mapR.html)               |
| [middle](https://mxxii.github.io/peberminta/functions/core.middle.html)           | [not](https://mxxii.github.io/peberminta/functions/core.not.html)                 | _[of](https://mxxii.github.io/peberminta/modules/core.html#of)_                 | [option](https://mxxii.github.io/peberminta/functions/core.option.html)           |
| _[or](https://mxxii.github.io/peberminta/modules/core.html#or)_                   | _[otherwise](https://mxxii.github.io/peberminta/modules/core.html#otherwise)_     | [peek](https://mxxii.github.io/peberminta/functions/core.peek.html)             | [recursive](https://mxxii.github.io/peberminta/functions/core.recursive.html)     |
| [reduceLeft](https://mxxii.github.io/peberminta/functions/core.reduceLeft.html)   | [reduceRight](https://mxxii.github.io/peberminta/functions/core.reduceRight.html) | _[refine](https://mxxii.github.io/peberminta/modules/core.html#refine)_         | [right](https://mxxii.github.io/peberminta/functions/core.right.html)             |
| [rightAssoc1](https://mxxii.github.io/peberminta/functions/core.rightAssoc1.html) | [rightAssoc2](https://mxxii.github.io/peberminta/functions/core.rightAssoc2.html) | [satisfy](https://mxxii.github.io/peberminta/functions/core.satisfy.html)       | [sepBy](https://mxxii.github.io/peberminta/functions/core.sepBy.html)             |
| [sepBy1](https://mxxii.github.io/peberminta/functions/core.sepBy1.html)           | [skip](https://mxxii.github.io/peberminta/functions/core.skip.html)               | _[some](https://mxxii.github.io/peberminta/modules/core.html#some)_             | [start](https://mxxii.github.io/peberminta/functions/core.start.html)             |
| [takeMinMax](https://mxxii.github.io/peberminta/functions/core.takeMinMax.html)   | [takeN](https://mxxii.github.io/peberminta/functions/core.takeN.html)             | [takeUntil](https://mxxii.github.io/peberminta/functions/core.takeUntil.html)   | [takeUntilP](https://mxxii.github.io/peberminta/functions/core.takeUntilP.html)   |
| [takeWhile](https://mxxii.github.io/peberminta/functions/core.takeWhile.html)     | [takeWhileP](https://mxxii.github.io/peberminta/functions/core.takeWhileP.html)   | [token](https://mxxii.github.io/peberminta/functions/core.token.html)           |                                                                                   |

</div>

#### Core utilities

<div class="headlessTable">

| <!-- -->                                                                    | <!-- -->                                                              | <!-- -->                                                                                | <!-- -->                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [match](https://mxxii.github.io/peberminta/functions/core.match.html)       | [parse](https://mxxii.github.io/peberminta/functions/core.parse.html) | [parserPosition](https://mxxii.github.io/peberminta/functions/core.parserPosition.html) | [remainingTokensNumber](https://mxxii.github.io/peberminta/functions/core.remainingTokensNumber.html) |
| [tryParse](https://mxxii.github.io/peberminta/functions/char.tryParse.html) |                                                                       |                                                                                         |                                                                                                       |

</div>

#### Char blocks

<div class="headlessTable">

| <!-- -->                                                                | <!-- -->                                                              | <!-- -->                                                                    | <!-- -->                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| _[anyOf](https://mxxii.github.io/peberminta/modules/char.html#anyOf)_   | [char](https://mxxii.github.io/peberminta/functions/char.char.html)   | [charTest](https://mxxii.github.io/peberminta/functions/char.charTest.html) | [concat](https://mxxii.github.io/peberminta/functions/char.concat.html) |
| [noneOf](https://mxxii.github.io/peberminta/functions/char.noneOf.html) | [oneOf](https://mxxii.github.io/peberminta/functions/char.oneOf.html) | [str](https://mxxii.github.io/peberminta/functions/char.str.html)           |                                                                         |

</div>

#### Char utilities

<div class="headlessTable">

| <!-- -->                                                              | <!-- -->                                                              | <!-- -->                                                                                | <!-- -->                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [match](https://mxxii.github.io/peberminta/functions/char.match.html) | [parse](https://mxxii.github.io/peberminta/functions/char.parse.html) | [parserPosition](https://mxxii.github.io/peberminta/functions/char.parserPosition.html) | [tryParse](https://mxxii.github.io/peberminta/functions/char.tryParse.html) |

</div>


## Turning grammars into parsers

[Extended Backus–Naur form](https://en.wikipedia.org/wiki/Extended_Backus%E2%80%93Naur_form) is a common notation for defining language grammars.

[Parsing Expression Grammar](https://en.wikipedia.org/wiki/Parsing_expression_grammar) (PEG) is another one.

There are many different dialects of those notations, it is impractical to capture them all here. See [this \*BNF comparison table](https://www.cs.man.ac.uk/~pjj/bnf/ebnf.html) for example.

[ANTLR](https://www.antlr.org/) (ANother Tool for Language Recognition) is a parser generator whose [meta language](https://www.antlr2.org/doc/metalang.html) is also commonly used to describe grammars ([more documentation](https://github.com/antlr/antlr4/blob/dev/doc/index.md)).

Here is a quick cross-reference to give a general idea how to turn production rules into `peberminta` parsers:

| Usage                              | ISO EBNF           | PEG                | ANTLR            | `peberminta`                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------ | ------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| terminal (string, character)       | `"foo"` or `'bar'` | `"foo"` or `'bar'` | `"foo"` or `'b'` | [char.str](https://mxxii.github.io/peberminta/functions/char.str.html), [char.char](https://mxxii.github.io/peberminta/functions/char.char.html), [core.token](https://mxxii.github.io/peberminta/functions/core.token.html) |
| any listed character               |                    | `[abc]`            | `[abc]`          | [char.oneOf](https://mxxii.github.io/peberminta/functions/char.oneOf.html)                                                                                                                                                   |
| character range                    |                    | `[a-z]`            | `"a".."z"`       | [char.charTest](https://mxxii.github.io/peberminta/functions/char.charTest.html)                                                                                                                                             |
| non-terminal                       | `...`              | `...`              | `...`            | a Parser instance                                                                                                                                                                                                            |
| concatenation, sequence            | `,`                | ` `                | ` `              | [core.all](https://mxxii.github.io/peberminta/functions/core.all.html), [core.ab](https://mxxii.github.io/peberminta/functions/core.ab.html), [core.abc](https://mxxii.github.io/peberminta/functions/core.abc.html)         |
| alternation, choice                | `\|`               | `/`                | `\|`             | [core.first](https://mxxii.github.io/peberminta/functions/core.first.html), [core.eitherOr](https://mxxii.github.io/peberminta/functions/core.eitherOr.html)                                                               |
| optional (0 or 1)                  | `[ ... ]`          | `...?`             | `...?`           | [core.option](https://mxxii.github.io/peberminta/functions/core.option.html)                                                                                                                                                 |
| repetition (0 or more)             | `{ ... }`          | `...*`             | `...*`           | [core.many](https://mxxii.github.io/peberminta/functions/core.many.html)                                                                                                                                                     |
| repetition (1 or more)             | `{ ... }-`         | `...+`             | `...+`           | [core.many1](https://mxxii.github.io/peberminta/functions/core.many1.html)                                                                                                                                                   |
| grouping                           | `( ... )`          | `( ... )`          | `( ... )`        | a Parser instance                                                                                                                                                                                                            |
| any token (wildcard)               |                    | `.`                | `.`              | [core.any](https://mxxii.github.io/peberminta/functions/core.any.html)                                                                                                                                                       |
| not (inversion)                    |                    | `!`                | `~`              | [core.not](https://mxxii.github.io/peberminta/functions/core.not.html)                                                                                                                                                       |
| and-predicate (positive lookahead) |                    | `&...`             | `( ... ) =>`     | [core.ahead](https://mxxii.github.io/peberminta/functions/core.ahead.html)                                                                                                                                                   |
| not-predicate (negative lookahead) |                    | `!...`             | `( ~... ) =>`    | combination of [core.not](https://mxxii.github.io/peberminta/functions/core.not.html) and [core.ahead](https://mxxii.github.io/peberminta/functions/core.ahead.html)                                                         |
| end of input                       |                    | `!.`               | `EOF`            | [core.end](https://mxxii.github.io/peberminta/functions/core.end.html)                                                                                                                                                       |

The same grammar can be described and implemented in multiple ways. There are more `peberminta` blocks, some of them might be fitting the original idea better than its expression in a limited formal grammar...

See the following examples that illustrate rule-by-rule implementation of a grammar using `peberminta` blocks:

- [McKeeman Form](https://github.com/mxxii/peberminta/blob/main/examples/mckeeman-form.ts);
- [JSON formal](https://github.com/mxxii/peberminta/blob/main/examples/json-formal.ts).


## What about ...?

- performance - The code is very simple but I won't put any unverified assumptions here. I'd be grateful to anyone who can set up a good benchmark project to compare different parser combinators.

- stable release - Current release is well thought out and tested. I leave a chance that some supplied functions may need an incompatible change. Before version 1.0.0 this will be done without a deprecation cycle.

- streams/iterators - Maybe some day, if the need to parse a stream of non-string tokens arise. For now I don't have a task that would force me to think well on how to design it. It would require a significant trade off and may end up being a separate module (like `char`) at best or even a separate package.

- Fantasy Land - You can find some familiar ideas here, especially when compared to Static Land. But I'm not concerned about compatibility with that spec - see "Practicality over "purity"" entry above. What I think might make sense is to add separate tests for laws applicable in context of this package. Low priority though.


## Some other parser combinator packages

- [parser-ts](https://github.com/gcanti/parser-ts);
- [arcsecond](https://github.com/francisrstokes/arcsecond);
- [parsimmon](https://github.com/jneen/parsimmon);
- [chevrotain](https://github.com/Chevrotain/chevrotain);
- [prsc.js](https://github.com/bwrrp/prsc.js);
- [lop](https://github.com/mwilliamson/lop);
- [parser-lang](https://github.com/disnet/parser-lang);
- *and more, with varied level of maintenance.*
