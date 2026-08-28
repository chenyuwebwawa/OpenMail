import type { DecodedHeader, HeaderLine, LibmimeOptions } from './types';

/** Mutable parser and builder for RFC-style message header blocks. */
declare class Headers {
    /** Whether header lines have been modified after construction. */
    changed: boolean;

    /** Original unparsed header source, or `false` when constructed from parsed lines. */
    headers: string | Buffer | false;

    /** Whether `headers` has been parsed into `lines`. */
    parsed: boolean;

    /** Parsed header lines, or `false` until parsing occurs. */
    lines: HeaderLine[] | false;

    /** MBOX `From ` prefix line, or `false` when absent. */
    mbox: string | false;

    /** HTTP request prefix line, or `false` when absent. */
    http: string | false;

    /**
     * Creates a mutable header collection.
     *
     * @param headers Raw header bytes/string, already parsed header lines, or `false` for an empty collection.
     * @param config Optional libmime configuration.
     */
    constructor(headers?: string | Buffer | HeaderLine[] | false, config?: LibmimeOptions);

    /**
     * Checks whether at least one header with the requested key exists.
     *
     * @param key Header field name to find, case-insensitively.
     * @returns `true` when the header exists.
     */
    hasHeader(key: string): boolean;

    /**
     * Gets all raw header lines for a key.
     *
     * @param key Header field name to find, case-insensitively.
     * @returns Full decoded header lines, including field names.
     */
    get(key: string): string[];

    /**
     * Gets all decoded structured header values for a key.
     *
     * @param key Header field name to decode, case-insensitively.
     * @returns Decoded header entries with key and value fields.
     */
    getDecoded(key: string): DecodedHeader[];

    /**
     * Gets the first decoded header value for a key.
     *
     * @param key Header field name to find, case-insensitively.
     * @returns Trimmed decoded value, or an empty string when the header is absent.
     */
    getFirst(key: string): string;

    /**
     * Gets the mutable parsed header list.
     *
     * @returns Parsed header lines in message order.
     */
    getList(): HeaderLine[];

    /**
     * Adds a folded header line.
     *
     * @param key Header field name to add.
     * @param value Header value; `undefined` leaves the collection unchanged.
     * @param index Insertion index, where omitted or less than 1 inserts at the top.
     * @returns Nothing.
     */
    add(key: string, value?: string | number | Buffer, index?: number): void;

    /**
     * Adds a preformatted header line.
     *
     * @param key Header field name used for normalized lookup.
     * @param line Full header line to insert; falsy values leave the collection unchanged.
     * @param index Insertion index, where omitted or less than 1 inserts at the top.
     * @returns Nothing.
     */
    addFormatted(key: string, line?: string | Buffer | false, index?: number): void;

    /**
     * Removes all headers matching a key.
     *
     * @param key Header field name to remove, case-insensitively.
     * @returns Nothing.
     */
    remove(key: string): void;

    /**
     * Replaces matching headers with a new folded header value.
     *
     * @param key Header field name to update.
     * @param value Header value to write; `undefined` removes matching values without adding a replacement.
     * @param relativeIndex Optional zero-based index among headers with the same key.
     * @returns Nothing.
     */
    update(key: string, value?: string | number | Buffer, relativeIndex?: number): void;

    /**
     * Builds a raw header block.
     *
     * @param lineEnd Line ending to use when rebuilding changed headers; defaults to CRLF.
     * @returns Header bytes ending with an empty header/body separator line.
     */
    build(lineEnd?: string | false): Buffer;
}

export = Headers;
