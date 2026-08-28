/// <reference types="node" />

import Splitter = require('./lib/message-splitter');
import Joiner = require('./lib/message-joiner');
import Rewriter = require('./lib/node-rewriter');
import Streamer = require('./lib/node-streamer');
import ChunkedPassthrough = require('./lib/chunked-passthrough');
import Headers = require('./lib/headers');
import MimeNode = require('./lib/mime-node');

export {
    /** Splits raw message bytes into MIME node and content chunks. */
    Splitter,

    /** Joins MIME node and content chunks back into raw message bytes. */
    Joiner,

    /** Rewrites body content for MIME nodes selected by a filter function. */
    Rewriter,

    /** Streams decoded body content for MIME nodes selected by a filter function. */
    Streamer,

    /** Buffers byte input and emits larger Buffer chunks. */
    ChunkedPassthrough,

    /** Parses, mutates, and rebuilds message header blocks. */
    Headers,

    /** Represents one parsed MIME node and its header/body metadata. */
    MimeNode
};

export type {
    /** Value that is either present as `T` or explicitly unavailable as `false`. */
    Maybe,

    /** Single item in an IMAP-style MIME part number. */
    PartNumberItem,

    /** IMAP-style path to a MIME part. */
    PartNumber,

    /** Options passed through to libmime instances. */
    LibmimeOptions,

    /** Configuration for `Splitter` and MIME node parsing. */
    SplitterOptions,

    /** Configuration for `ChunkedPassthrough`. */
    ChunkedPassthroughOptions,

    /** Configuration for format=flowed decoding. */
    FlowedDecoderOptions,

    /** Parsed raw header line with a normalized lookup key. */
    HeaderLine,

    /** Decoded structured header value. */
    DecodedHeader,

    /** Data or body bytes emitted by `Splitter`. */
    MessageChunk,

    /** Sentinel input used internally by rewriter/streamer transforms. */
    EmptyChunk,

    /** Object emitted by `Splitter`. */
    SplitterChunk,

    /** Object accepted by rewriter and streamer transforms. */
    RewriterInput,

    /** Predicate used to select MIME nodes. */
    FilterFunc,

    /** Error object that may include a Node-style string code. */
    ErrorWithCode,

    /** Callback that resumes processing after a selected node stream ends. */
    ContinueCallback,

    /** Content transform stream used for decoded or encoded node bodies. */
    ContentStream,

    /** Decoder stream with an internal readable-state guard. */
    DecoderStream,

    /** Internal splitter grouping state. */
    SplitterGroup,

    /** Payload emitted with `Rewriter`'s `node` event. */
    RewriterNode,

    /** Payload emitted with `Streamer`'s `node` event. */
    StreamerNode
} from './lib/types';
