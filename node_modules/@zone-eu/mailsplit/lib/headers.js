'use strict';

const libmime = require('libmime');

/** @typedef {import('..').HeaderLine} HeaderLine */
/** @typedef {import('..').LibmimeOptions} LibmimeOptions */
/** @typedef {import('..').DecodedHeader} DecodedHeader */

const Libmime = /** @type {any} */ (libmime.Libmime);

/**
 * Parses and builds message headers. A Headers instance allows callers to
 * inspect, delete, update, and add header lines.
 */
class Headers {
    /**
     * @param {string | Buffer | HeaderLine[] | false} [headers] Raw header source or already parsed lines.
     * @param {LibmimeOptions} [config] Optional libmime configuration.
     */
    constructor(headers, config) {
        config = config || {};

        if (Array.isArray(headers)) {
            // already using parsed headers
            this.changed = true;
            /** @type {string | Buffer | false} */
            this.headers = false;
            this.parsed = true;
            /** @type {HeaderLine[] | false} */
            this.lines = headers;
        } else {
            // using original string/buffer headers
            this.changed = false;
            /** @type {string | Buffer | false} */
            this.headers = headers || false;
            this.parsed = false;
            /** @type {HeaderLine[] | false} */
            this.lines = false;
        }
        /** @type {string | false} */
        this.mbox = false;
        /** @type {string | false} */
        this.http = false;

        this.libmime = new Libmime({ Iconv: config.Iconv });
    }

    /**
     * @param {string} key
     * @returns {boolean}
     */
    hasHeader(key) {
        if (!this.parsed) {
            this._parseHeaders();
        }
        let lines = this._getLines();
        key = this._normalizeHeader(key);
        return typeof lines.find(line => line.key === key) === 'object';
    }

    /**
     * @param {string} key
     * @returns {string[]}
     */
    get(key) {
        if (!this.parsed) {
            this._parseHeaders();
        }
        let headerLines = this._getLines();
        key = this._normalizeHeader(key);
        let lines = headerLines.filter(line => line.key === key).map(line => this._decodeHeaderValue(line.line));

        return lines;
    }

    /**
     * @param {string} key
     * @returns {DecodedHeader[]}
     */
    getDecoded(key) {
        return this.get(key)
            .map(line => this.libmime.decodeHeader(line))
            .filter(line => line && line.value);
    }

    /**
     * @param {string} key
     * @returns {string}
     */
    getFirst(key) {
        if (!this.parsed) {
            this._parseHeaders();
        }
        let lines = this._getLines();
        key = this._normalizeHeader(key);
        let header = lines.find(line => line.key === key);
        if (!header) {
            return '';
        }
        return ((this.libmime.decodeHeader(this._decodeHeaderValue(header.line)) || {}).value || '').toString().trim();
    }

    /**
     * @returns {HeaderLine[]}
     */
    getList() {
        if (!this.parsed) {
            this._parseHeaders();
        }
        return this._getLines();
    }

    /**
     * @param {string} key
     * @param {string | number | Buffer} [value]
     * @param {number} [index]
     * @returns {void}
     */
    add(key, value, index) {
        if (typeof value === 'undefined') {
            return;
        }

        if (typeof value === 'number') {
            value = value.toString();
        }

        if (typeof value === 'string') {
            value = Buffer.from(value);
        }

        value = value.toString('binary');
        // a header value may not contain line breaks of its own, folding is added by foldLines
        this.addFormatted(key, this.libmime.foldLines(key + ': ' + value.replace(/[\r\n]/g, ''), 76, false), index);
    }

    /**
     * @param {string} key
     * @param {string | Buffer | false} [line]
     * @param {number} [index]
     * @returns {void}
     */
    addFormatted(key, line, index) {
        if (!this.parsed) {
            this._parseHeaders();
        }
        let lines = this._getLines();
        index = index || 0;
        this.changed = true;

        if (!line) {
            return;
        }

        if (typeof line !== 'string') {
            line = line.toString('binary');
        }

        // every header insertion runs through here, so this is where a value or a key
        // built from untrusted input is stopped from injecting an extra header line
        line = this._normalizeInsertedLine(line);
        if (!line) {
            return;
        }

        let header = {
            key: this._normalizeHeader(key),
            line
        };

        if (index < 1) {
            lines.unshift(header);
        } else if (index >= lines.length) {
            lines.push(header);
        } else {
            lines.splice(index, 0, header);
        }
    }

    /**
     * @param {string} key
     * @returns {void}
     */
    remove(key) {
        if (!this.parsed) {
            this._parseHeaders();
        }
        let lines = this._getLines();
        key = this._normalizeHeader(key);
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].key === key) {
                this.changed = true;
                lines.splice(i, 1);
            }
        }
    }

    /**
     * @param {string} key
     * @param {string | number | Buffer} [value]
     * @param {number} [relativeIndex]
     * @returns {void}
     */
    update(key, value, relativeIndex) {
        if (!this.parsed) {
            this._parseHeaders();
        }
        let lines = this._getLines();
        let keyName = key;
        let index = 0;
        key = this._normalizeHeader(key);
        let relativeIndexCount = 0;
        let relativeMatchFound = false;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].key === key) {
                if (relativeIndex && relativeIndex !== relativeIndexCount) {
                    relativeIndexCount++;
                    continue;
                }
                index = i;
                this.changed = true;
                lines.splice(i, 1);
                if (relativeIndex) {
                    relativeMatchFound = true;
                    break;
                }
            }
        }

        if (relativeIndex && !relativeMatchFound) {
            return;
        }

        this.add(keyName, value, index);
    }

    /**
     * Serializes the headers. Unmodified headers are returned byte for byte as they
     * were received, otherwise every line is rebuilt with `lineEnd` line endings.
     *
     * @param {string | false} [lineEnd] Line ending to use, defaults to CRLF.
     * @returns {Buffer}
     */
    build(lineEnd) {
        if (!this.changed && !lineEnd) {
            return typeof this.headers === 'string' ? Buffer.from(this.headers, 'binary') : this.headers || Buffer.alloc(0);
        }

        if (!this.parsed) {
            this._parseHeaders();
        }
        let lines = this._getLines();

        const ending = lineEnd || '\r\n';

        let headers = lines
            .map(line => this._normalizeLineBreaks(line.line, ending))
            // an empty line would close the header block and demote every later header
            // into the body, so a line left with nothing in it is dropped instead
            .filter(line => line !== '')
            .map(line => this._buildHeaderLine(line))
            .reduce((joined, line, idx) => {
                if (idx) {
                    joined.push(Buffer.from(ending, 'binary'));
                }
                joined.push(line);
                return joined;
            }, /** @type {Buffer[]} */ ([]));

        headers.push(Buffer.from(ending + ending, 'binary'));

        if (this.mbox) {
            headers.unshift(Buffer.from(this.mbox + ending, 'binary'));
        }

        if (this.http) {
            headers.unshift(Buffer.from(this.http + ending, 'binary'));
        }

        return Buffer.concat(headers);
    }

    /**
     * @param {string} key
     * @returns {string}
     */
    _normalizeHeader(key) {
        return (key || '').toLowerCase().trim();
    }

    /**
     * Rewrites the line breaks of a header line so that the line can only ever parse
     * back as the single header it was reported as. A line break followed by whitespace
     * is folding and becomes `lineEnd`, every other line break would start a new header
     * line and is dropped.
     *
     * A bare <CR> is never a line break for _parseHeaders, so promoting one here would
     * emit a header line that was never reported as parsed.
     *
     * @param {string} line Header line to normalize.
     * @param {string} lineEnd Line ending to fold with.
     * @returns {string} Line with only folding line breaks left.
     */
    _normalizeLineBreaks(line, lineEnd) {
        return (
            line
                // lines are joined with lineEnd, so a line that opens with a break of its own
                // would close the header block. Dropping only the break leaves any whitespace
                // behind it folding into the line before, which adds no header of its own.
                .replace(/^[\r\n]+/, '')
                .replace(/\r\n|\r|\n/g, (match, offset, source) => (match !== '\r' && this._isFoldingChar(source.charAt(offset + match.length)) ? lineEnd : ''))
        );
    }

    /**
     * Prepares a caller supplied line for insertion. On top of the line break rules an
     * inserted line has to stand on its own: a leading fold or indent would attach it to
     * whichever header happens to precede it, and a leading line break would close the
     * header block outright.
     *
     * Lines that were parsed out of a message keep their leading whitespace instead, so
     * that rebuilding can never turn an indented continuation into a header of its own.
     *
     * An inserted line is normalized twice, here with CRLF and again in build() with the
     * line ending the caller asked for. That is only sound because _normalizeLineBreaks is
     * idempotent over its own output: the folds this pass emits are still recognized as
     * folds by the next one. Any change to how a fold is represented has to keep that true.
     *
     * @param {string} line Formatted header line supplied by the caller.
     * @returns {string} Line that inserts as exactly one header, or an empty string.
     */
    _normalizeInsertedLine(line) {
        return this._normalizeLineBreaks(line.replace(/^[\r\n \t]+/, ''), '\r\n');
    }

    /**
     * Tells whether a character continues the previous header line rather than
     * starting a new one. Used by both the parser and the builder so that the two
     * can not disagree on what folding is.
     *
     * @param {string} chr Character that follows a line break.
     * @returns {boolean} True if the line break is folding.
     */
    _isFoldingChar(chr) {
        return chr === ' ' || chr === '\t';
    }

    /**
     * @returns {HeaderLine[]}
     */
    _getLines() {
        if (!this.lines) {
            this.lines = [];
        }
        return this.lines;
    }

    /**
     * @returns {void}
     */
    _parseHeaders() {
        if (!this.headers) {
            this.lines = [];
            this.parsed = true;
            return;
        }

        /** @type {Array<string | HeaderLine>} */
        let lines = this.headers
            .toString('binary')
            .replace(/[\r\n]+$/, '')
            .split(/\r?\n/);

        for (let i = lines.length - 1; i >= 0; i--) {
            let currentLine = /** @type {string} */ (lines[i]);
            if (i && this._isFoldingChar(currentLine.charAt(0))) {
                lines[i - 1] = /** @type {string} */ (lines[i - 1]) + '\r\n' + currentLine;
                lines.splice(i, 1);
            } else {
                let line = currentLine;
                if (!i && /^From /i.test(line)) {
                    // mbox file
                    this.mbox = line;
                    lines.splice(i, 1);
                    continue;
                } else if (!i && /^POST /i.test(line)) {
                    // HTTP POST request
                    this.http = line;
                    lines.splice(i, 1);
                    continue;
                }
                let key = this._normalizeHeader(line.substr(0, line.indexOf(':')));
                lines[i] = {
                    key,
                    line
                };
            }
        }

        this.lines = /** @type {HeaderLine[]} */ (lines);
        this.parsed = true;
    }

    /**
     * @param {string} line
     * @returns {Buffer}
     */
    _buildHeaderLine(line) {
        let value = this._decodeHeaderValue(line);
        return Buffer.from(value, value === line ? 'binary' : 'utf8');
    }

    /**
     * @param {string} str
     * @returns {string}
     */
    _decodeHeaderValue(str) {
        if (!str) {
            return str;
        }

        let utf8 = Buffer.from(str, 'binary').toString('utf8');
        return utf8.includes('\uFFFD') ? str : utf8;
    }
}

// expose to the world
module.exports = Headers;
