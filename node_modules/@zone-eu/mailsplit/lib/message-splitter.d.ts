import { Transform } from 'node:stream';
import type { SplitterChunk, SplitterOptions } from './types';

/** Transform stream that splits raw email bytes into MIME node and content chunks. */
declare class MessageSplitter extends Transform {
    /**
     * Creates a splitter that accepts Buffer input and emits `SplitterChunk` objects.
     *
     * @param config Optional parser limits and embedded-message behavior.
     */
    constructor(config?: SplitterOptions);

    /**
     * Registers a listener for parsed splitter chunks.
     *
     * @param event Event name.
     * @param listener Receives each parsed MIME node, data chunk, or body chunk.
     * @returns This splitter instance.
     */
    on(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Registers a one-time listener for the next parsed splitter chunk.
     *
     * @param event Event name.
     * @param listener Receives the next parsed MIME node, data chunk, or body chunk.
     * @returns This splitter instance.
     */
    once(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Adds a listener for parsed splitter chunks.
     *
     * @param event Event name.
     * @param listener Receives each parsed MIME node, data chunk, or body chunk.
     * @returns This splitter instance.
     */
    addListener(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Prepends a listener for parsed splitter chunks.
     *
     * @param event Event name.
     * @param listener Receives each parsed MIME node, data chunk, or body chunk.
     * @returns This splitter instance.
     */
    prependListener(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Emits a parsed splitter chunk.
     *
     * @param event Event name.
     * @param data MIME node, data chunk, or body chunk to emit.
     * @returns `true` when the event had listeners.
     */
    emit(event: 'data', data: SplitterChunk): boolean;
}

export = MessageSplitter;
