'use strict';

const { Transform } = require('stream');

/**
 * Transform stream that buffers byte input and emits larger Buffer chunks.
 */
class ChunkedPassthrough extends Transform {
    /**
     * @param {import('..').ChunkedPassthroughOptions} [options]
     */
    constructor(options = {}) {
        let config = {
            readableObjectMode: true,
            writableObjectMode: false
        };
        super(config);
        this.chunkSize = options.chunkSize || 64 * 1024; // 64KB default
        this.buffer = Buffer.alloc(0);
    }

    /**
     * @param {Buffer} chunk
     * @param {BufferEncoding} encoding
     * @param {import('stream').TransformCallback} callback
     * @returns {void}
     */
    _transform(chunk, encoding, callback) {
        this.buffer = Buffer.concat([this.buffer, chunk]);

        if (this.buffer.length >= this.chunkSize) {
            this.push(this.buffer);
            this.buffer = Buffer.alloc(0);
        }

        callback();
    }

    /**
     * @param {import('stream').TransformCallback} callback
     * @returns {void}
     */
    _flush(callback) {
        // Send remaining data
        if (this.buffer.length > 0) {
            this.push(this.buffer);
            this.buffer = Buffer.alloc(0);
        }
        callback();
    }
}

module.exports = ChunkedPassthrough;
