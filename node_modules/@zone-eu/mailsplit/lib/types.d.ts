import type { PassThrough, Transform } from 'node:stream';
import type Headers = require('./headers');

/** Value that is either present as `T` or explicitly unavailable as `false`. */
export type Maybe<T> = T | false;

/** Single item in an IMAP-style MIME part number. */
export type PartNumberItem = number | 'TEXT';

/** IMAP-style path to a MIME part, for example `[1, 2, 'TEXT']`. */
export type PartNumber = PartNumberItem[];

/** Options passed through to libmime instances created by this package. */
export interface LibmimeOptions {
    /** Optional iconv-compatible implementation used by libmime for charset conversion. */
    Iconv?: unknown;
}

/** Configuration for `MessageSplitter` and MIME node parsing. */
export interface SplitterOptions extends LibmimeOptions {
    /** Treat `message/rfc822` parts as leaf nodes instead of parsing embedded messages. */
    ignoreEmbedded?: boolean;

    /** Parse embedded messages as inline unless their disposition is `attachment`. */
    defaultInlineEmbedded?: boolean;

    /** Maximum header block size, in bytes, allowed for a single MIME node. */
    maxHeadSize?: number;

    /** Maximum number of MIME child nodes accepted before parsing fails. */
    maxChildNodes?: number;
}

/** Configuration for `ChunkedPassthrough`. */
export interface ChunkedPassthroughOptions {
    /** Buffered byte threshold for non-final chunks. Defaults to 64 KiB. */
    chunkSize?: number;
}

/** Configuration for `FlowedDecoder`. */
export interface FlowedDecoderOptions extends LibmimeOptions {
    /** Whether format=flowed uses RFC 3676 `DelSp=yes` space deletion semantics. */
    delSp?: boolean;

    /** Source Content-Transfer-Encoding hint used during format=flowed handling. */
    encoding?: string | false;
}

/** Parsed raw header line with a normalized lookup key. */
export interface HeaderLine {
    /** Lower-case header key used for comparisons and lookups. */
    key: string;

    /** Full header line, including the original field name, value, and any folded continuations. */
    line: string;
}

/** Decoded structured header value returned by libmime. */
export interface DecodedHeader {
    /** Header key returned by libmime for the decoded value. */
    key: string;

    /** Unicode decoded header value. */
    value: string;
}

/** MIME node emitted by `MessageSplitter` and accepted by `MessageJoiner`. */
export interface MimeNode {
    /** Discriminator identifying this chunk as a MIME node. */
    type: 'node';

    /** Whether this node is the root message node. */
    root: boolean;

    /** Parent MIME node, or `false` for the root node. */
    parentNode: MimeNode | false;

    /** Boundary used by this multipart node, or `false` when not multipart. */
    _boundary: Buffer | false;

    /** Boundary inherited from the parent multipart node, or `false` when absent. */
    _parentBoundary: Buffer | false;

    /** Node whose boundary `_parentBoundary` was copied from. */
    _parentBoundaryOwner: MimeNode | false;

    /** Length, in bytes, of the raw header block collected for this node. */
    _headerlen: number;

    /** Multipart subtype such as `mixed` or `alternative`, or `false` for leaf nodes. */
    multipart: string | false;

    /** Content-Transfer-Encoding value, normalized to lower case, or `false` when absent. */
    encoding: string | false;

    /** Parsed and mutable header collection, available after headers are parsed. */
    headers: Headers | false;

    /** MIME content type such as `text/plain`, or `false` when unavailable. */
    contentType: string | false;

    /** Charset parameter from Content-Type, or `false` when absent. */
    charset: string | false;

    /** Content-Disposition value such as `inline` or `attachment`, or `false` when absent. */
    disposition: string | false;

    /** Decoded filename from Content-Disposition or Content-Type parameters, or `false` when absent. */
    filename: string | false;

    /** Whether this node is `text/*` with `format=flowed`. */
    flowed: boolean;

    /** Whether flowed text uses `delsp=yes`. */
    delSp: boolean;

    /** Splitter configuration used when parsing this node. */
    config: SplitterOptions;

    /** Resolved IMAP-style part number for this node, or `false` before resolution. */
    partNr: PartNumber | false;

    /** Number of child part numbers allocated by this node. */
    childPartNumbers: number;

    /** Whether this node's content type is `message/rfc822`. */
    rfc822: boolean;

    /** Whether an embedded `message/rfc822` node was parsed as a nested message. */
    messageNode?: boolean;

    /**
     * Builds the next child part number for this node.
     *
     * @param provided Optional explicit part number item to append.
     * @returns Resolved MIME part number.
     */
    getPartNr(provided?: PartNumberItem): PartNumber;

    /**
     * Appends one raw header line to this node while parsing.
     *
     * @param line Raw header line bytes; falsy values are ignored.
     * @returns Nothing.
     */
    addHeaderChunk(line?: Buffer | false): void;

    /**
     * Parses collected header bytes and populates MIME metadata fields.
     *
     * @returns Nothing.
     */
    parseHeaders(): void;

    /**
     * Builds this node's header block.
     *
     * @returns Header bytes ending with an empty header/body separator line.
     */
    getHeaders(): Buffer;

    /**
     * Sets or updates the Content-Type header value.
     *
     * @param contentType MIME content type to set; falsy keeps the current type.
     * @returns Nothing.
     */
    setContentType(contentType?: string | false): void;

    /**
     * Sets, updates, or removes the Content-Type charset parameter.
     *
     * @param charset Charset to set; falsy removes it when possible.
     * @returns Nothing.
     */
    setCharset(charset?: string | false): void;

    /**
     * Sets, updates, or removes the filename parameter.
     *
     * @param filename Filename to set; falsy removes it when possible.
     * @returns Nothing.
     */
    setFilename(filename?: string | false): void;

    /**
     * Creates a decoder stream for this node's transfer encoding.
     *
     * @returns Transform stream that outputs decoded content bytes.
     */
    getDecoder(): Transform | PassThrough;

    /**
     * Creates an encoder stream and updates the Content-Transfer-Encoding header when needed.
     *
     * @param encoding Target transfer encoding; defaults to the node's current encoding.
     * @returns Transform stream that outputs encoded content bytes.
     */
    getEncoder(encoding?: string | false): Transform | PassThrough;
}

/** Data or body bytes emitted by `MessageSplitter`. */
export interface MessageChunk {
    /** MIME node that owns or precedes this chunk. */
    node: MimeNode;

    /** Chunk kind: multipart structure bytes (`data`) or leaf content bytes (`body`). */
    type: 'data' | 'body';

    /** Raw chunk bytes. */
    value: Buffer;
}

/** Sentinel input used internally to finish a pending rewriter or streamer node. */
export interface EmptyChunk {
    /** Discriminator for an empty control chunk. */
    type: 'none';
}

/** Object emitted by `MessageSplitter`: either a MIME node or a data/body byte chunk. */
export type SplitterChunk = MimeNode | MessageChunk;

/** Object accepted by rewriter and streamer transforms. */
export type RewriterInput = SplitterChunk | EmptyChunk;

/**
 * Predicate used to select MIME nodes.
 *
 * @param node MIME node being inspected.
 * @returns `true` to process the node, otherwise `false`.
 */
export type FilterFunc = (node: MimeNode) => boolean;

/** Error object that may include a Node-style string error code. */
export type ErrorWithCode = Error & { code?: string };

/**
 * Callback that resumes processing after a selected node stream has ended.
 *
 * @returns Nothing.
 */
export type ContinueCallback = () => void;

/** Content transform stream used for decoded or encoded node bodies. */
export type ContentStream = Transform | PassThrough;

/** Decoder stream with an internal readable-state guard used by rewriter/streamer. */
export type DecoderStream = ContentStream & { $reading?: boolean };

/** Internal grouping state used while splitter coalesces adjacent chunks. */
export interface SplitterGroup {
    /** MIME node associated with the group, when one exists. */
    node?: MimeNode;

    /** Group kind currently being accumulated. */
    type: 'none' | 'node' | 'data' | 'body';

    /** Buffered raw bytes for `data` or `body` groups. */
    value?: Buffer;
}

/** Payload emitted with `NodeRewriter`'s `node` event. */
export interface RewriterNode {
    /** Selected MIME node whose body can be rewritten. */
    node: MimeNode;

    /** Stream that yields decoded original body bytes. */
    decoder: Transform;

    /** Stream that accepts replacement decoded bytes and emits properly encoded body bytes. */
    encoder: Transform;
}

/** Payload emitted with `NodeStreamer`'s `node` event. */
export interface StreamerNode {
    /** Selected MIME node whose body is being streamed. */
    node: MimeNode;

    /** Stream that yields decoded original body bytes. */
    decoder: Transform;

    /**
     * Signals that the consumer has finished reading the selected node.
     *
     * @returns Nothing.
     */
    done: () => void;
}
