import { Transform } from 'node:stream';
import type { FlowedDecoderOptions } from './types';

/** Transform stream that decodes `text/plain; format=flowed` content. */
declare class FlowedDecoder extends Transform {
    /**
     * Creates a flowed text decoder that accepts encoded text bytes and emits decoded Buffer chunks.
     *
     * @param config Optional flowed text and charset decoding settings.
     */
    constructor(config?: FlowedDecoderOptions);

    /**
     * Registers a listener for decoded flowed text bytes.
     *
     * @param event Event name.
     * @param listener Receives decoded Buffer chunks.
     * @returns This decoder instance.
     */
    on(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Registers a one-time listener for the next decoded flowed text chunk.
     *
     * @param event Event name.
     * @param listener Receives the next decoded Buffer chunk.
     * @returns This decoder instance.
     */
    once(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Adds a listener for decoded flowed text bytes.
     *
     * @param event Event name.
     * @param listener Receives decoded Buffer chunks.
     * @returns This decoder instance.
     */
    addListener(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Prepends a listener for decoded flowed text bytes.
     *
     * @param event Event name.
     * @param listener Receives decoded Buffer chunks.
     * @returns This decoder instance.
     */
    prependListener(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Emits a decoded flowed text chunk.
     *
     * @param event Event name.
     * @param data Buffer chunk to emit.
     * @returns `true` when the event had listeners.
     */
    emit(event: 'data', data: Buffer): boolean;
}

export = FlowedDecoder;
