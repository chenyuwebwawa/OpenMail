import { Transform } from 'node:stream';
import type { FilterFunc, RewriterNode, SplitterChunk } from './types';

/** Transform stream that replaces the body content of selected MIME nodes. */
declare class NodeRewriter extends Transform {
    /**
     * Creates a node rewriter that accepts splitter chunks and emits rewritten splitter chunks.
     *
     * @param filterFunc Predicate that selects MIME nodes to rewrite.
     * @param rewriteAction Optional compatibility hook stored on the instance; consumers usually handle the `node` event.
     */
    constructor(filterFunc: FilterFunc, rewriteAction?: Function);

    /**
     * Registers a listener for rewritten splitter chunks.
     *
     * @param event Event name.
     * @param listener Receives each outgoing MIME node, data chunk, or body chunk.
     * @returns This rewriter instance.
     */
    on(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Registers a listener for selected nodes.
     *
     * @param event Event name.
     * @param listener Receives decoder and encoder streams for a selected node.
     * @returns This rewriter instance.
     */
    on(event: 'node', listener: (data: RewriterNode) => void): this;

    /**
     * Registers a one-time listener for the next rewritten splitter chunk.
     *
     * @param event Event name.
     * @param listener Receives the next outgoing MIME node, data chunk, or body chunk.
     * @returns This rewriter instance.
     */
    once(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Registers a one-time listener for the next selected node.
     *
     * @param event Event name.
     * @param listener Receives decoder and encoder streams for the next selected node.
     * @returns This rewriter instance.
     */
    once(event: 'node', listener: (data: RewriterNode) => void): this;

    /**
     * Adds a listener for rewritten splitter chunks.
     *
     * @param event Event name.
     * @param listener Receives each outgoing MIME node, data chunk, or body chunk.
     * @returns This rewriter instance.
     */
    addListener(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Adds a listener for selected nodes.
     *
     * @param event Event name.
     * @param listener Receives decoder and encoder streams for a selected node.
     * @returns This rewriter instance.
     */
    addListener(event: 'node', listener: (data: RewriterNode) => void): this;

    /**
     * Prepends a listener for rewritten splitter chunks.
     *
     * @param event Event name.
     * @param listener Receives each outgoing MIME node, data chunk, or body chunk.
     * @returns This rewriter instance.
     */
    prependListener(event: 'data', listener: (data: SplitterChunk) => void): this;

    /**
     * Prepends a listener for selected nodes.
     *
     * @param event Event name.
     * @param listener Receives decoder and encoder streams for a selected node.
     * @returns This rewriter instance.
     */
    prependListener(event: 'node', listener: (data: RewriterNode) => void): this;

    /**
     * Emits a rewritten splitter chunk.
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
     * @param data Selected node payload containing decoder and encoder streams.
     * @returns `true` when the event had listeners.
     */
    emit(event: 'node', data: RewriterNode): boolean;
}

export = NodeRewriter;
