'use strict';

const Headers = require('./headers');
const libmime = require('libmime');
const libqp = require('libqp');
// @ts-ignore
const libbase64 = require('libbase64');
const PassThrough = require('stream').PassThrough;
const pathlib = require('path');

/** @typedef {import('..').Headers} HeadersType */
/** @typedef {import('..').PartNumberItem} PartNumberItem */
/** @typedef {import('..').PartNumber} PartNumber */
/** @typedef {import('..').SplitterOptions} SplitterOptions */
/** @typedef {import('libmime').StructuredHeader} StructuredHeader */
/** @typedef {import('stream').Transform | import('stream').PassThrough} ContentStream */
/** @typedef {import('..').MimeNode} MimeNodeType */

const Libmime = /** @type {any} */ (libmime.Libmime);

/**
 * Parsed MIME node with mutable headers and transfer-encoding helpers.
 */
class MimeNode {
    /**
     * @param {MimeNodeType | false} parentNode Parent node, or false for the root node.
     * @param {SplitterOptions} [config] Splitter and libmime configuration.
     */
    constructor(parentNode, config) {
        /** @type {'node'} */
        this.type = 'node';
        this.root = !parentNode;
        /** @type {MimeNodeType | false} */
        this.parentNode = parentNode;

        /** @type {Buffer | false} */
        this._parentBoundary = this.parentNode && this.parentNode._boundary;
        // the node whose boundary _parentBoundary was copied from, recorded here so that
        // a delimiter for it never has to be matched back to an owner by walking the tree
        /** @type {MimeNodeType | false} */
        this._parentBoundaryOwner = this.parentNode || false;
        /** @type {Buffer[]} */
        this._headersLines = [];
        this._headerlen = 0;

        /** @type {StructuredHeader | false} */
        this._parsedContentType = false;
        /** @type {StructuredHeader | false} */
        this._parsedContentDisposition = false;
        /** @type {Buffer | false} */
        this._boundary = false;

        /** @type {string | false} */
        this.multipart = false;
        /** @type {string | false} */
        this.encoding = false;
        /** @type {HeadersType | false} */
        this.headers = false;
        /** @type {string | false} */
        this.contentType = false;
        /** @type {string | false} */
        this.charset = false;
        /** @type {string | false} */
        this.disposition = false;
        /** @type {string | false} */
        this.filename = false;
        this.flowed = false;
        this.delSp = false;

        this.config = config || {};
        this.libmime = new Libmime({ Iconv: this.config.Iconv });

        /** @type {PartNumber} */
        this.parentPartNumber = [];
        /** @type {PartNumber | false} */
        this.partNr = false; // resolved later
        this.childPartNumbers = 0;
        this.rfc822 = false;
        /** @type {boolean | undefined} */
        this.messageNode = undefined;
    }

    /**
     * @param {PartNumberItem} [provided]
     * @returns {PartNumber}
     */
    getPartNr(provided) {
        /** @type {PartNumber} */
        let partNr = this.partNr || [];
        if (provided) {
            return partNr.filter(nr => !isNaN(Number(nr))).concat(provided);
        }
        let childPartNr = ++this.childPartNumbers;
        return partNr.filter(nr => !isNaN(Number(nr))).concat(childPartNr);
    }

    /**
     * @param {Buffer | false} [line]
     * @returns {void}
     */
    addHeaderChunk(line) {
        if (!line) {
            return;
        }
        this._headersLines.push(line);
        this._headerlen += line.length;
    }

    /**
     * @returns {void}
     */
    parseHeaders() {
        if (this.headers) {
            return;
        }
        this.headers = new Headers(Buffer.concat(this._headersLines, this._headerlen), this.config);
        let headers = this.headers;

        this._parsedContentDisposition = this.libmime.parseHeaderValue(headers.getFirst('Content-Disposition'));
        let parsedContentDisposition = /** @type {StructuredHeader} */ (this._parsedContentDisposition);

        // if content-type is missing default to plaintext
        let contentHeader;
        if (headers.get('Content-Type').length) {
            contentHeader = headers.getFirst('Content-Type');
        } else {
            if (parsedContentDisposition.params.filename) {
                let extension = pathlib.parse(parsedContentDisposition.params.filename).ext.replace(/^\./, '');
                if (extension) {
                    contentHeader = libmime.detectMimeType(extension);
                }
            }
            if (!contentHeader) {
                if (/^attachment$/i.test(parsedContentDisposition.value)) {
                    contentHeader = 'application/octet-stream';
                } else {
                    contentHeader = 'text/plain';
                }
            }
        }

        this._parsedContentType = this.libmime.parseHeaderValue(contentHeader);
        let parsedContentType = /** @type {StructuredHeader} */ (this._parsedContentType);

        this.encoding = headers
            .getFirst('Content-Transfer-Encoding')
            .replace(/\(.*\)/g, '')
            .toLowerCase()
            .trim();
        this.contentType = (parsedContentType.value || '').toLowerCase().trim() || false;
        this.charset = parsedContentType.params.charset || false;
        this.disposition = (parsedContentDisposition.value || '').toLowerCase().trim() || false;

        // fix invalidly encoded disposition values
        if (this.disposition) {
            try {
                this.disposition = this.libmime.decodeWords(this.disposition);
            } catch (E) {
                // failed to parse disposition, keep as is (most probably an unknown charset is used)
            }
        }

        this.filename = parsedContentDisposition.params.filename || parsedContentType.params.name || false;

        if (parsedContentType.params.format && parsedContentType.params.format.toLowerCase().trim() === 'flowed') {
            this.flowed = true;
            if (parsedContentType.params.delsp && parsedContentType.params.delsp.toLowerCase().trim() === 'yes') {
                this.delSp = true;
            }
        }

        if (this.filename) {
            try {
                this.filename = this.libmime.decodeWords(this.filename);
            } catch (E) {
                // failed to parse filename, keep as is (most probably an unknown charset is used)
            }
        }

        this.multipart =
            (this.contentType &&
                this.contentType.substr(0, this.contentType.indexOf('/')) === 'multipart' &&
                this.contentType.substr(this.contentType.indexOf('/') + 1)) ||
            false;
        this._boundary = (parsedContentType.params.boundary && Buffer.from(parsedContentType.params.boundary)) || false;

        this.rfc822 = this.contentType === 'message/rfc822';

        if (!this.parentNode || this.parentNode.rfc822) {
            this.partNr = this.parentNode ? this.parentNode.getPartNr('TEXT') : ['TEXT'];
        } else {
            this.partNr = this.parentNode ? this.parentNode.getPartNr() : [];
        }
    }

    /**
     * @returns {Buffer}
     */
    getHeaders() {
        if (!this.headers) {
            this.parseHeaders();
        }
        let headers = /** @type {HeadersType} */ (this.headers);
        return headers.build();
    }

    /**
     * @param {string | false} [contentType]
     * @returns {void}
     */
    setContentType(contentType) {
        if (!this.headers) {
            this.parseHeaders();
        }
        let headers = /** @type {HeadersType} */ (this.headers);
        let parsedContentType = /** @type {StructuredHeader} */ (this._parsedContentType);

        contentType = (contentType || '').toLowerCase().trim();
        if (contentType) {
            parsedContentType.value = contentType;
        }

        if (!this.flowed && parsedContentType.params.format) {
            delete parsedContentType.params.format;
        }

        if (!this.delSp && parsedContentType.params.delsp) {
            delete parsedContentType.params.delsp;
        }

        headers.update('Content-Type', this.libmime.buildHeaderValue(parsedContentType));
    }

    /**
     * @param {string | false} [charset]
     * @returns {void}
     */
    setCharset(charset) {
        if (!this.headers) {
            this.parseHeaders();
        }
        let headers = /** @type {HeadersType} */ (this.headers);
        let parsedContentType = /** @type {StructuredHeader} */ (this._parsedContentType);

        charset = (charset || '').toLowerCase().trim();

        if (charset === 'ascii') {
            charset = '';
        }

        if (!charset) {
            if (!parsedContentType.value) {
                // nothing to set or update
                return;
            }
            delete parsedContentType.params.charset;
        } else {
            parsedContentType.params.charset = charset;
        }

        if (!parsedContentType.value) {
            parsedContentType.value = 'text/plain';
        }

        headers.update('Content-Type', this.libmime.buildHeaderValue(parsedContentType));
    }

    /**
     * @param {string | false} [filename]
     * @returns {void}
     */
    setFilename(filename) {
        if (!this.headers) {
            this.parseHeaders();
        }
        let headers = /** @type {HeadersType} */ (this.headers);
        let parsedContentType = /** @type {StructuredHeader} */ (this._parsedContentType);
        let parsedContentDisposition = /** @type {StructuredHeader} */ (this._parsedContentDisposition);

        this.filename = (filename || '').toLowerCase().trim();

        if (parsedContentType.params.name) {
            delete parsedContentType.params.name;
            headers.update('Content-Type', this.libmime.buildHeaderValue(parsedContentType));
        }

        if (!this.filename) {
            if (!parsedContentDisposition.value) {
                // nothing to set or update
                return;
            }
            delete parsedContentDisposition.params.filename;
        } else {
            parsedContentDisposition.params.filename = this.filename;
        }

        if (!parsedContentDisposition.value) {
            parsedContentDisposition.value = 'attachment';
        }

        headers.update('Content-Disposition', this.libmime.buildHeaderValue(parsedContentDisposition));
    }

    /**
     * @returns {import('stream').Transform | import('stream').PassThrough}
     */
    getDecoder() {
        if (!this.headers) {
            this.parseHeaders();
        }

        switch (this.encoding) {
            case 'base64':
                return new libbase64.Decoder();
            case 'quoted-printable':
                return new libqp.Decoder();
            default:
                return new PassThrough();
        }
    }

    /**
     * @param {string | false} [encoding]
     * @returns {import('stream').Transform | import('stream').PassThrough}
     */
    getEncoder(encoding) {
        if (!this.headers) {
            this.parseHeaders();
        }
        let headers = /** @type {HeadersType} */ (this.headers);

        encoding = (encoding || '').toString().toLowerCase().trim();

        if (encoding && encoding !== this.encoding) {
            headers.update('Content-Transfer-Encoding', encoding);
        } else {
            encoding = this.encoding;
        }

        switch (encoding) {
            case 'base64':
                return new libbase64.Encoder();
            case 'quoted-printable':
                return new libqp.Encoder();
            default:
                return new PassThrough();
        }
    }
}

module.exports = MimeNode;
