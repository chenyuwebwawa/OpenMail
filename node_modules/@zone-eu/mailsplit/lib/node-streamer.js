'use strict';

// Helper class to stream selected nodes by MIME metadata

const Transform = require('stream').Transform;
const FlowedDecoder = require('./flowed-decoder');

/** @typedef {import('..').MimeNode} MimeNode */
/** @typedef {import('..').RewriterInput} RewriterInput */
/** @typedef {import('..').FilterFunc} FilterFunc */
/** @typedef {import('..').StreamerNode} StreamerNode */
/** @typedef {import('..').DecoderStream} DecoderStream */
/** @typedef {import('..').ContinueCallback} ContinueCallback */

/**
 * NodeStreamer Transform stream. Exposes decoded content for nodes selected by
 * the filter function while passing the original message through unchanged.
 *
 * @param {FilterFunc} filterFunc Function that receives a MIME node and returns true to stream it.
 * @param {Function} [streamAction] Optional compatibility hook stored on the instance.
 */
class NodeStreamer extends Transform {
    /**
     * @param {FilterFunc} filterFunc Function that receives a MIME node and returns true to stream it.
     * @param {Function} [streamAction] Optional compatibility hook stored on the instance.
     */
    constructor(filterFunc, streamAction) {
        let options = {
            readableObjectMode: true,
            writableObjectMode: true
        };
        super(options);

        this.filterFunc = filterFunc;
        this.streamAction = streamAction;

        /** @type {DecoderStream | false} */
        this.decoder = false;
        this.canContinue = false;
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
            this.push(data);
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

            /**
             * Resumes processing with the first chunk after the streamed node.
             *
             * @returns {void}
             */
            let doContinue = () => {
                this.continue = false;
                this.decoder = false;
                this.canContinue = false;
                this.processIncoming(data, callback);
            };

            if (this.canContinue) {
                setImmediate(doContinue);
            } else {
                this.continue = () => doContinue();
            }

            this.decoder.end();
            return;
        } else if (data.type === 'node' && this.filterFunc(data)) {
            this.push(data);
            // found matching node, create new handler
            this.emit('node', this.createDecoder(data));
        } else if (this.readable && data.type !== 'none') {
            // we don't care about this data, just pass it over to the joiner
            this.push(data);
        }
        callback();
    }

    /**
     * @param {MimeNode} node
     * @returns {StreamerNode}
     */
    createDecoder(node) {
        this.decoder = /** @type {DecoderStream} */ (node.getDecoder());

        let decoder = /** @type {DecoderStream} */ (this.decoder);
        decoder.$reading = false;

        if (/^text\//.test(node.contentType || '') && node.flowed) {
            let flowDecoder = decoder;
            decoder = new FlowedDecoder({
                delSp: node.delSp
            });
            flowDecoder.on(
                'error',
                /**
                 * Forwards flowed decoder errors to the output decoder.
                 *
                 * @param {Error} err Decoder error to forward.
                 * @returns {void}
                 */
                err => {
                    decoder.emit('error', err);
                }
            );
            flowDecoder.pipe(decoder);
        }

        return {
            node,
            decoder,
            /**
             * Marks the selected node stream as consumed so the passthrough can continue.
             *
             * @returns {void}
             */
            done: () => {
                if (typeof this.continue === 'function') {
                    // called once input stream is processed
                    this.continue();
                } else {
                    // called before input stream is processed
                    this.canContinue = true;
                }
            }
        };
    }
}

module.exports = NodeStreamer;
