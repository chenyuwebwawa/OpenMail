import type { ContentStream, MimeNode as MimeNodeShape, PartNumber, PartNumberItem, SplitterOptions } from './types';
import type Headers = require('./headers');

/** Parsed MIME node with mutable headers and content encoding helpers. */
declare class MimeNode implements MimeNodeShape {
    /** Discriminator identifying this chunk as a MIME node. */
    type: 'node';

    /** Whether this node is the root message node. */
    root: boolean;

    /** Parent MIME node, or `false` for the root node. */
    parentNode: MimeNodeShape | false;

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
     * Creates a MIME node with empty header state.
     *
     * @param parentNode Parent node, or `false`/omitted for the root node.
     * @param config Optional splitter and libmime configuration.
     */
    constructor(parentNode?: MimeNodeShape | false, config?: SplitterOptions);

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
    getDecoder(): ContentStream;

    /**
     * Creates an encoder stream and updates the Content-Transfer-Encoding header when needed.
     *
     * @param encoding Target transfer encoding; defaults to the node's current encoding.
     * @returns Transform stream that outputs encoded content bytes.
     */
    getEncoder(encoding?: string | false): ContentStream;
}

export = MimeNode;
