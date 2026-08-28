'use strict';

// Helper class to rewrite nodes with specific mime type

const Transform = require('stream').Transform;
const FlowedDecoder = require('./flowed-decoder');

/** @typedef {import('..').MimeNode} MimeNode */
/** @typedef {import('..').RewriterInput} RewriterInput */
/** @typedef {import('..').FilterFunc} FilterFunc */
/** @typedef {import('..').RewriterNode} RewriterNode */
/** @typedef {import('..').DecoderStream} DecoderStream */
/** @typedef {import('..').ContentStream} ContentStream */
/** @typedef {import('..').ContinueCallback} ContinueCallback */

/**
 * NodeRewriter Transform stream. Updates content for all nodes selected by the
 * filter function.
 *
 * @param {FilterFunc} filterFunc Function that receives a MIME node and returns true to rewrite it.
 * @param {Function} [rewriteAction] Optional compatibility hook stored on the instance.
 */
class NodeRewriter extends Transform {
    /**
     * @param {FilterFunc} filterFunc Function that receives a MIME node and returns true to rewrite it.
     * @param {Function} [rewriteAction] Optional compatibility hook stored on the instance.
     */
    constructor(filterFunc, rewriteAction) {
        let options = {
            readableObjectMode: true,
            writableObjectMode: true
        };
        super(options);

        this.filterFunc = filterFunc;
        this.rewriteAction = rewriteAction;

        /** @type {DecoderStream | false} */
        this.decoder = false;
        /** @type {ContentStream | false} */
        this.encoder = false;
        /** @type {ContinueCallback | false} */
        this.continue = false;
    }

    /**
     * @param {RewriterInput} data
     * @param {BufferEncoding} encoding
     * @param {import('stream').TransformCallback} callback
     * @returns {void}
     */
    _transform(data, encoding, callback) {
        this.processIncoming(data, callback);
    }

    /**
     * @param {import('stream').TransformCallback} callback
     * @returns {void}
     */
    _flush(callback) {
        if (this.decoder) {
            // emit an empty node just in case there is pending data to end
            return this.processIncoming(
                {
                    type: 'none'
                },
                callback
            );
        }
        return callback();
    }

    /**
     * @param {RewriterInput} data
     * @param {import('stream').TransformCallback} callback
     * @returns {void}
     */
    processIncoming(data, callback) {
        if (this.decoder && data.type === 'body') {
            // data to parse
            if (!this.decoder.write(data.value)) {
                this.decoder.once('drain', callback);
                return;
            } else {
                return callback();
            }
        } else if (this.decoder && data.type !== 'body') {
            // stop decoding.
            // we can not process the current data chunk as we need to wait until
            // the parsed data is completely processed, so we store a reference to the
            // continue callback
            this.continue = () => {
                this.continue = false;
                this.decoder = false;
                this.encoder = false;
                this.processIncoming(data, callback);
            };
            this.decoder.end();
            return;
        } else if (data.type === 'node' && this.filterFunc(data)) {
            // found matching node, create new handler
            this.emit('node', this.createDecodePair(data));
        } else if (this.readable && data.type !== 'none') {
            // we don't care about this data, just pass it over to the joiner
            this.push(data);
        }
        callback();
    }

    /**
     * @param {MimeNode} node
     * @returns {RewriterNode}
     */
    createDecodePair(node) {
        this.decoder = /** @type {DecoderStream} */ (node.getDecoder());

        if (['base64', 'quoted-printable'].includes(node.encoding || '')) {
            this.encoder = node.getEncoder();
        } else {
            this.encoder = node.getEncoder('quoted-printable');
        }

        /** @type {number | false} */
        let lastByte = false;

        let decoder = /** @type {DecoderStream} */ (this.decoder);
        let encoder = /** @type {ContentStream} */ (this.encoder);
        let firstChunk = true;
        decoder.$reading = false;

        /**
         * Reads encoded replacement bytes and forwards them as body chunks.
         *
         * @returns {void | NodeJS.Immediate}
         */
        let readFromEncoder = () => {
            decoder.$reading = true;

            let data = encoder.read();
            if (data === null) {
                decoder.$reading = false;
                return;
            }

            if (firstChunk) {
                firstChunk = false;
                if (this.readable) {
                    this.push(node);
                }
            }

            let writeMore = true;
            if (this.readable) {
                writeMore = this.push({
                    node,
                    type: 'body',
                    value: data
                });
                lastByte = data && data.length && data[data.length - 1];
            }

            if (writeMore) {
                return setImmediate(readFromEncoder);
            } else {
                encoder.pause();
                // no idea how to catch drain? use timeout for now as poor man's substitute
                // this.once('drain', () => encoder.resume());
                setTimeout(() => {
                    encoder.resume();
                    setImmediate(readFromEncoder);
                }, 100);
            }
        };

        encoder.on('readable', () => {
            if (!decoder.$reading) {
                return readFromEncoder();
            }
        });

        encoder.on('end', () => {
            if (firstChunk) {
                firstChunk = false;
                if (this.readable) {
                    this.push(node);
                }
            }

            if (lastByte !== 0x0a) {
                // make sure there is a terminating line break
                this.push({
                    node,
                    type: 'body',
                    value: Buffer.from([0x0a])
                });
            }

            if (this.continue) {
                return this.continue();
            }
        });

        if (/^text\//.test(node.contentType || '') && node.flowed) {
            // text/plain; format=flowed is a special case
            let flowDecoder = decoder;
            decoder = new FlowedDecoder({
                delSp: node.delSp,
                encoding: node.encoding || false
            });
            flowDecoder.on(
                'error',
                /**
                 * Forwards flowed decoder errors to the replacement decoder.
                 *
                 * @param {Error} err Decoder error to forward.
                 * @returns {void}
                 */
                err => {
                    decoder.emit('error', err);
                }
            );
            flowDecoder.pipe(decoder);

            // we don't know what kind of data we are going to get, does it comply with the
            // requirements of format=flowed, so we just cancel it
            node.flowed = false;
            node.delSp = false;
            node.setContentType();
        }

        return {
            node,
            decoder,
            encoder
        };
    }
}

module.exports = NodeRewriter;
