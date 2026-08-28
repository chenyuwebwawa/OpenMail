'use strict';

const Transform = require('stream').Transform;

/** @typedef {import('..').SplitterChunk} SplitterChunk */

/**
 * Transform stream that joins splitter objects back into raw message bytes.
 */
class MessageJoiner extends Transform {
    /**
     * Creates a joiner that accepts splitter objects and emits Buffer chunks.
     */
    constructor() {
        let options = {
            readableObjectMode: false,
            writableObjectMode: true
        };
        super(options);
    }

    /**
     * @param {SplitterChunk | Buffer} obj
     * @param {BufferEncoding} encoding
     * @param {import('stream').TransformCallback} callback
     * @returns {void}
     */
    _transform(obj, encoding, callback) {
        if (Buffer.isBuffer(obj)) {
            this.push(obj);
        } else if (obj.type === 'node') {
            this.push(obj.getHeaders());
        } else if (obj.value) {
            this.push(obj.value);
        }
        return callback();
    }

    /**
     * @param {import('stream').TransformCallback} callback
     * @returns {void}
     */
    _flush(callback) {
        return callback();
    }
}

module.exports = MessageJoiner;
