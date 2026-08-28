import { Transform } from 'node:stream';

/** Transform stream that joins splitter objects back into raw email bytes. */
declare class MessageJoiner extends Transform {
    /**
     * Creates a joiner that accepts splitter objects and emits Buffer chunks.
     */
    constructor();

    /**
     * Registers a listener for generated message bytes.
     *
     * @param event Event name.
     * @param listener Receives each generated Buffer chunk.
     * @returns This joiner instance.
     */
    on(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Registers a one-time listener for generated message bytes.
     *
     * @param event Event name.
     * @param listener Receives the next generated Buffer chunk.
     * @returns This joiner instance.
     */
    once(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Adds a listener for generated message bytes.
     *
     * @param event Event name.
     * @param listener Receives each generated Buffer chunk.
     * @returns This joiner instance.
     */
    addListener(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Prepends a listener for generated message bytes.
     *
     * @param event Event name.
     * @param listener Receives each generated Buffer chunk.
     * @returns This joiner instance.
     */
    prependListener(event: 'data', listener: (data: Buffer) => void): this;

    /**
     * Emits a generated message byte chunk.
     *
     * @param event Event name.
     * @param data Buffer chunk to emit.
     * @returns `true` when the event had listeners.
     */
    emit(event: 'data', data: Buffer): boolean;
}

export = MessageJoiner;
