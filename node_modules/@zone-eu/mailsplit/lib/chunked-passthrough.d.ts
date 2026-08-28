import { Transform } from 'node:stream';
import type { ChunkedPassthroughOptions } from './types';

/** Transform stream that buffers byte input and emits larger Buffer chunks. */
declare class ChunkedPassthrough extends Transform {
    /**
     * Creates a chunking passthrough transform that accepts Buffer input and emits Buffer chunks.
     *
     * @param options Optional chunk size configuration.
     */
    constructor(options?: ChunkedPassthroughOptions);

    /**
     * Registers a listener for buffered byte chunks.
     *
     * @param event Event name.
     * @param listener Receives each buffered Buffer chunk.
     * @returns This passthrough instance.
     */
    on(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Registers a one-time listener for the next buffered byte chunk.
     *
     * @param event Event name.
     * @param listener Receives the next buffered Buffer chunk.
     * @returns This passthrough instance.
     */
    once(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Adds a listener for buffered byte chunks.
     *
     * @param event Event name.
     * @param listener Receives each buffered Buffer chunk.
     * @returns This passthrough instance.
     */
    addListener(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Prepends a listener for buffered byte chunks.
     *
     * @param event Event name.
     * @param listener Receives each buffered Buffer chunk.
     * @returns This passthrough instance.
     */
    prependListener(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Emits a buffered byte chunk.
     *
     * @param event Event name.
     * @param data Buffer chunk to emit.
     * @returns `true` when the event had listeners.
     */
    emit(event: 'data', data: Buffer): boolean;
}

export = ChunkedPassthrough;
