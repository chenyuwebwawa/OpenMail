import { Transform } from 'node:stream';
import type { FilterFunc, SplitterChunk, StreamerNode } from './types';

/** Transform stream that exposes decoded body streams for selected MIME nodes without replacing them. */
declare class NodeStreamer extends Transform {
    /**
     * Creates a node streamer that accepts splitter chunks and passes them through unchanged.
     *
     * @param filterFunc Predicate that selects MIME nodes to stream.
     * @param streamAction Optional compatibility hook stored on the instance; consumers usually handle the `node` event.
     */
    constructor(filterFunc: FilterFunc, streamAction?: Function);

    /**
     * Registers a listener for passed-through splitter chunks.
     *
     * @param event Event name.
     * @param listener Receives each outgoing MIME node, data chunk, or body chunk.
     * @returns This streamer instance.
     */
    on(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Registers a listener for selected nodes.
     *
     * @param event Event name.
     * @param listener Receives a decoder stream and completion callback for a selected node.
     * @returns This streamer instance.
     */
    on(event: 'node', listener: (data: StreamerNode) => void): this;

    /**
     * Registers a one-time listener for the next passed-through splitter chunk.
     *
     * @param event Event name.
     * @param listener Receives the next outgoing MIME node, data chunk, or body chunk.
     * @returns This streamer instance.
     */
    once(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Registers a one-time listener for the next selected node.
     *
     * @param event Event name.
     * @param listener Receives a decoder stream and completion callback for the next selected node.
     * @returns This streamer instance.
     */
    once(event: 'node', listener: (data: StreamerNode) => void): this;

    /**
     * Adds a listener for passed-through splitter chunks.
     *
     * @param event Event name.
     * @param listener Receives each outgoing MIME node, data chunk, or body chunk.
     * @returns This streamer instance.
     */
    addListener(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Adds a listener for selected nodes.
     *
     * @param event Event name.
     * @param listener Receives a decoder stream and completion callback for a selected node.
     * @returns This streamer instance.
     */
    addListener(event: 'node', listener: (data: StreamerNode) => void): this;

    /**
     * Prepends a listener for passed-through splitter chunks.
     *
     * @param event Event name.
     * @param listener Receives each outgoing MIME node, data chunk, or body chunk.
     * @returns This streamer instance.
     */
    prependListener(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Prepends a listener for selected nodes.
     *
     * @param event Event name.
     * @param listener Receives a decoder stream and completion callback for a selected node.
     * @returns This streamer instance.
     */
    prependListener(event: 'node', listener: (data: StreamerNode) => void): this;

    /**
     * Emits a passed-through splitter chunk.
     *
     * @param event Event name.
     * @param data MIME node, data chunk, or body chunk to emit.
     * @returns `true` when the event had listeners.
     */
    emit(event: 'data', data: SplitterChunk): boolean;

    /**
     * Emits a selected-node payload.
     *
     * @param event Event name.
     * @param data Selected node payload containing decoder stream and completion callback.
     * @returns `true` when the event had listeners.
     */
    emit(event: 'node', data: StreamerNode): boolean;
}

export = NodeStreamer;
