'use strict';

const Transform = require('stream').Transform;
const MimeNode = require('./mime-node');

/** @typedef {import('..').MimeNode} MimeNodeType */
/** @typedef {import('..').MessageChunk} MessageChunk */
/** @typedef {import('..').SplitterChunk} SplitterChunk */
/** @typedef {import('..').SplitterGroup} SplitterGroup */
/** @typedef {import('..').SplitterOptions} SplitterOptions */
/** @typedef {(err?: (Error & {code?: string}) | null, data?: SplitterChunk | MessageChunk | false, flush?: boolean) => void} ProcessLineCallback */

const MAX_HEAD_SIZE = 1 * 1024 * 1024;
const MAX_CHILD_NODES = 1000;

// how much of a body line without a line break is buffered before it is flushed
// out as regular content instead of being kept in memory
const MAX_PENDING_LINE_SIZE = 64 * 1024;

// how many separate writes the pending line may be kept in before it is compacted
const MAX_PENDING_LINE_CHUNKS = 1024;

// what a delimiter line may carry after the boundary value: the "--" prefix, an optional
// "--" suffix and the line terminator. This is the bound compareBoundary() accepts.
const BOUNDARY_LINE_SUFFIX = 2 /* "--" prefix */ + 2 /* "--" suffix */ + 2; /* trailing <CR><LF> */

// checkBoundary() additionally allows a line ending in front of the delimiter, so this is
// the longest a delimiter line can ever be once the boundary value is subtracted
const BOUNDARY_LINE_OVERHEAD = BOUNDARY_LINE_SUFFIX + 2; /* leading <CR><LF> */

const HEAD = 0x01;
const BODY = 0x02;

/**
 * Creates the error used for all size limit violations.
 *
 * @param {string} message Human readable error message.
 * @returns {Error & {code: string}} Error tagged with the EMAXLEN code.
 */
function maxLenError(message) {
    let err = /** @type {Error & {code: string}} */ (new Error(message));
    err.code = 'EMAXLEN';
    return err;
}

/**
 * Moves an end offset back over the line ending that closes a body line, because the line
 * ending in front of a boundary belongs to the delimiter and not to the part content. Only
 * a group holding the body of a child node carries such a line ending, anything else is
 * returned untouched.
 *
 * @param {SplitterGroup} group Group the offsets describe.
 * @param {Buffer} chunk Chunk the offsets point into.
 * @param {number} start Start offset of the body slice.
 * @param {number} end End offset of the body slice.
 * @returns {number} End offset with a trailing <CR><LF>, <LF> or nothing removed.
 */
function trimBodyLineEnd(group, chunk, start, end) {
    if (group.type !== 'body' || !group.node || !group.node.parentNode) {
        return end;
    }
    if (end > start && chunk[end - 1] === 0x0a) {
        end--;
        if (end > start && chunk[end - 1] === 0x0d) {
            end--;
        }
    }
    return end;
}

/**
 * Transform stream that splits raw email bytes into MIME node and content chunks.
 */
class MessageSplitter extends Transform {
    /**
     * @param {SplitterOptions} [config]
     */
    constructor(config) {
        let options = {
            readableObjectMode: true,
            writableObjectMode: false
        };
        super(options);

        this.config = config || {};
        this.maxHeadSize = this.config.maxHeadSize || MAX_HEAD_SIZE;
        this.maxChildNodes = this.config.maxChildNodes || MAX_CHILD_NODES;
        this.nodeCounter = 0;
        this.node = /** @type {MimeNodeType} */ (/** @type {unknown} */ (null));
        // set once the closing delimiter of the current node's multipart has been seen, so
        // that any later boundary line of that node counts as epilogue. Reset per node.
        this.inEpilogue = false;
        this.newNode();
        // incomplete trailing line of the previous chunk, kept as a list of chunks so
        // that a long line without a line break is not copied over for every write
        /** @type {Buffer[]} */
        this.lineChunks = [];
        this.lineLength = 0;
        this.hasFailed = false;
        // set when the pending line was flushed as overlong content, the remainder
        // of that same line can not be a boundary either
        this.pendingLineTruncated = false;
    }

    /**
     * Appends unterminated trailing data to the pending line.
     *
     * @param {Buffer} chunk Data that follows the last line break of a write.
     * @returns {void}
     */
    appendPendingLine(chunk) {
        if (!chunk.length) {
            return;
        }
        this.lineChunks.push(chunk);
        this.lineLength += chunk.length;
        if (this.lineChunks.length >= MAX_PENDING_LINE_CHUNKS) {
            // a line written one byte at a time would otherwise cost an array slot and a
            // Buffer view per byte, which is far more memory than the data itself
            this.lineChunks = [Buffer.concat(this.lineChunks, this.lineLength)];
        }
    }

    /**
     * Returns the pending line as a single buffer and clears the pending state.
     *
     * @returns {Buffer | false} Pending line contents or false if there was none.
     */
    takePendingLine() {
        if (!this.lineLength) {
            return false;
        }
        let line = this.lineChunks.length === 1 ? this.lineChunks[0] : Buffer.concat(this.lineChunks, this.lineLength);
        this.lineChunks = [];
        this.lineLength = 0;
        return line;
    }

    /**
     * @param {Buffer} chunk
     * @param {BufferEncoding} encoding
     * @param {import('stream').TransformCallback} callback
     * @returns {void}
     */
    _transform(chunk, encoding, callback) {
        // process line by line
        // find next line ending
        let pos = 0;
        let i = 0;
        /** @type {SplitterGroup} */
        let group = {
            type: 'none'
        };
        let groupstart = this.lineLength ? -this.lineLength : 0;
        let groupend = 0;

        /**
         * Removes a pending line break from body data that belongs to a following boundary.
         *
         * @param {MessageChunk} data Body chunk to adjust in place.
         * @returns {void}
         */
        let checkTrailingLinebreak = data => {
            if (data.type === 'body' && data.node.parentNode && data.value && data.value.length) {
                if (data.value[data.value.length - 1] === 0x0a) {
                    groupstart--;
                    groupend--;
                    pos--;
                    if (data.value.length > 1 && data.value[data.value.length - 2] === 0x0d) {
                        groupstart--;
                        groupend--;
                        pos--;
                        if (groupstart < 0 && !this.lineLength) {
                            // store only <CR> as <LF> should be on the positive side
                            this.appendPendingLine(Buffer.from([0x0d]));
                        }
                        data.value = data.value.slice(0, data.value.length - 2);
                    } else {
                        data.value = data.value.slice(0, data.value.length - 1);
                    }
                } else if (data.value[data.value.length - 1] === 0x0d) {
                    groupstart--;
                    groupend--;
                    pos--;
                    data.value = data.value.slice(0, data.value.length - 1);
                }
            }
        };

        /**
         * Iterates the current input chunk line by line and emits parsed groups.
         *
         * @returns {void}
         */
        let iterateData = () => {
            for (let len = chunk.length; i < len; i++) {
                // find next <LF>
                if (chunk[i] === 0x0a) {
                    // line end

                    let start = Math.max(pos, 0);
                    pos = ++i;

                    return this.processLine(chunk.slice(start, i), false, (err, data, flush) => {
                        if (err) {
                            this.hasFailed = true;
                            return setImmediate(() => callback(err));
                        }

                        if (!data) {
                            return setImmediate(iterateData);
                        }

                        if (flush) {
                            if (group && group.type !== 'none') {
                                // do not include the last line ending for body
                                groupend = trimBodyLineEnd(group, chunk, groupstart, groupend);
                                if (groupstart < groupend) {
                                    // re-slice, the value the line was emitted with may
                                    // still include the line ending we just trimmed
                                    group.value = chunk.slice(groupstart, groupend);
                                    if (groupend < i && 'value' in data) {
                                        // the trimmed line ending belongs to the boundary line
                                        data.value = chunk.slice(groupend, i);
                                    }
                                }
                                // the group is pushed even when nothing is left of it, so that a
                                // part whose whole body is a line ending still reports a body
                                this.push(group);
                                group = {
                                    type: 'none'
                                };
                                groupstart = groupend = i;
                            }
                            this.push(data);
                            groupend = i;
                            return setImmediate(iterateData);
                        }

                        if (data.type === group.type) {
                            // shift slice end position forward
                            groupend = i;
                        } else {
                            // do not include the last line ending for body
                            groupend = trimBodyLineEnd(group, chunk, groupstart, groupend);

                            if (group.type !== 'none' && group.type !== 'node') {
                                // we have a previous data/body chunk to output
                                if (groupstart !== groupend) {
                                    group.value = chunk.slice(groupstart, groupend);
                                    if (group.value && group.value.length) {
                                        this.push(group);
                                        group = {
                                            type: 'none'
                                        };
                                    }
                                }
                            }

                            if (data.type === 'node') {
                                this.push(data);
                                groupstart = i;
                                groupend = i;
                            } else if (groupstart < 0) {
                                groupstart = i;
                                groupend = i;
                                checkTrailingLinebreak(data);
                                if (data.value && data.value.length) {
                                    this.push(data);
                                }
                            } else {
                                // start new body/data chunk
                                group = data;
                                groupstart = groupend;
                                groupend = i;
                            }
                        }
                        return setImmediate(iterateData);
                    });
                }
            }

            // skip last linebreak for body
            pos = trimBodyLineEnd(group, chunk, groupstart, pos);

            if (group.type !== 'none' && group.type !== 'node' && pos > groupstart) {
                // we have a leftover data/body chunk to push out
                group.value = chunk.slice(groupstart, pos);

                if (group.value && group.value.length) {
                    this.push(group);
                    group = {
                        type: 'none'
                    };
                }
            }

            if (pos < chunk.length) {
                // checkTrailingLinebreak can push pos before the start of this write when a
                // line ending straddles it. A negative start would make slice() count from
                // the END of the buffer and hand over the wrong bytes entirely.
                this.appendPendingLine(chunk.slice(Math.max(pos, 0)));
            }

            let pendingLineError = this.enforcePendingLineLimit();
            if (pendingLineError) {
                this.hasFailed = true;
                return callback(pendingLineError);
            }
            callback();
        };

        setImmediate(iterateData);
    }

    /**
     * @param {import('stream').TransformCallback} callback
     * @returns {void}
     */
    _flush(callback) {
        if (this.hasFailed) {
            return callback();
        }
        this.processLine(false, true, (err, data) => {
            if (err) {
                return setImmediate(() => callback(err));
            }
            if (data && (data.type === 'node' || (data.value && data.value.length))) {
                this.push(data);
            }
            callback();
        });
    }

    /**
     * @param {Buffer} line
     * @param {number} startpos
     * @param {Buffer} boundary
     * @returns {1 | 2 | false}
     */
    compareBoundary(line, startpos, boundary) {
        // --{boundary}\r\n or --{boundary}--\r\n
        if (line.length < boundary.length + 3 + startpos || line.length > boundary.length + BOUNDARY_LINE_SUFFIX + startpos) {
            return false;
        }
        for (let i = 0; i < boundary.length; i++) {
            if (line[i + 2 + startpos] !== boundary[i]) {
                return false;
            }
        }

        let pos = 0;
        for (let i = boundary.length + 2 + startpos; i < line.length; i++) {
            let c = line[i];
            if (pos === 0 && (c === 0x0d || c === 0x0a)) {
                // 1: next node
                return 1;
            }
            if (pos === 0 && c !== 0x2d) {
                // expecting "-"
                return false;
            }
            if (pos === 1 && c !== 0x2d) {
                // expecting "-"
                return false;
            }
            if (pos === 2 && c !== 0x0d && c !== 0x0a) {
                // expecting line terminator, either <CR> or <LF>
                return false;
            }
            if (pos === 3 && c !== 0x0a) {
                // expecting line terminator <LF>
                return false;
            }
            pos++;
        }

        // 2: multipart end
        return 2;
    }

    /**
     * @param {Buffer} line
     * @returns {1 | 2 | 3 | 4 | false}
     */
    checkBoundary(line) {
        let startpos = 0;
        if (line.length >= 1 && (line[0] === 0x0d || line[0] === 0x0a)) {
            startpos++;
            if (line.length >= 2 && line[0] === 0x0d && line[1] === 0x0a) {
                // only <CR><LF> is two bytes, a lone <CR> in front of a delimiter is one
                startpos++;
            }
        }
        if (line.length < 4 || line[startpos] !== 0x2d || line[startpos + 1] !== 0x2d) {
            // defnitely not a boundary
            return false;
        }

        /** @type {1 | 2 | false} */
        let boundary;
        if (!this.inEpilogue && this.node._boundary && (boundary = this.compareBoundary(line, startpos, this.node._boundary))) {
            // 1: next child
            // 2: multipart end
            return boundary;
        }

        if (this.node._parentBoundary && (boundary = this.compareBoundary(line, startpos, this.node._parentBoundary))) {
            // 3: next sibling
            // 4: parent end
            return /** @type {3 | 4} */ (boundary + 2);
        }

        return false;
    }

    /**
     * Checks the header bytes collected for the current node against maxHeadSize.
     *
     * @param {number} [extra] Bytes that belong to the header block but are not stored yet.
     * @returns {(Error & {code?: string}) | null} Error object if the limit was exceeded.
     */
    checkHeadSize(extra) {
        if (this.node._headerlen + (extra || 0) > this.maxHeadSize) {
            return maxLenError('Max header size for a MIME node exceeded');
        }
        return null;
    }

    /**
     * Enforces the limits on the pending line so that it can not grow without bound.
     * A line that is still short enough to become a boundary delimiter is always kept.
     * Past that length it is a header line and counts against maxHeadSize, or it is
     * body content, in which case it is pushed out rather than held in memory. Flushing
     * marks the pending line truncated, so the tail of it is not tested as a delimiter.
     *
     * @returns {(Error & {code?: string}) | null} Error object if a limit was exceeded.
     */
    enforcePendingLineLimit() {
        if (!this.lineLength) {
            return null;
        }

        let maxBoundaryLength = Math.max(
            this.node._boundary ? this.node._boundary.length : 0,
            this.node._parentBoundary ? this.node._parentBoundary.length : 0
        );

        if (this.lineLength <= maxBoundaryLength + BOUNDARY_LINE_OVERHEAD) {
            // might still turn out to be a boundary delimiter line
            return null;
        }

        if (this.state === HEAD) {
            // not a boundary line, so it is a header line and counts against the
            // header size limit even though it has not been stored on the node yet
            return this.checkHeadSize(this.lineLength);
        }

        if (this.lineLength < MAX_PENDING_LINE_SIZE) {
            return null;
        }

        let value = /** @type {Buffer} */ (this.takePendingLine());
        if (value[value.length - 1] === 0x0d) {
            // a trailing <CR> may still turn out to be the first half of the line ending
            // that closes this line, and a line ending in front of a boundary belongs to
            // the delimiter. Keep it pending so the normal trimming can decide. Copy it
            // rather than slicing, a view would pin the whole flushed buffer.
            this.appendPendingLine(Buffer.from([0x0d]));
            value = value.slice(0, value.length - 1);
        }

        this.push({
            node: this.node,
            type: this.node.multipart ? 'data' : 'body',
            value
        });
        // whatever follows continues an overlong line, so the tail of it
        // can not be a boundary line either
        this.pendingLineTruncated = true;

        return null;
    }

    /**
     * @param {Buffer | false} line
     * @param {boolean} final
     * @param {ProcessLineCallback} next
     * @returns {void}
     */
    processLine(line, final, next) {
        let flush = false;

        // consumed here so that no later branch can leak it into the next line
        let truncatedLine = this.pendingLineTruncated;
        this.pendingLineTruncated = false;

        let pending = this.takePendingLine();
        if (pending) {
            line = line ? Buffer.concat([pending, line]) : pending;
        }

        if (!line) {
            line = Buffer.alloc(0);
        }

        if (this.nodeCounter > this.maxChildNodes) {
            return next(maxLenError('Max allowed child nodes exceeded'));
        }

        // we check boundary outside the HEAD/BODY scope as it may appear anywhere
        // unless the line is the remainder of an already flushed overlong line
        let boundary = truncatedLine ? false : this.checkBoundary(line);
        if (boundary) {
            // reached boundary, switch context
            switch (boundary) {
                case 1:
                    // next child
                    this.newNode(this.node);
                    flush = true;
                    break;
                case 2:
                    // reached end of children, keep current node
                    break;
                case 3: {
                    // next sibling
                    this.newNode(this.parentMultipartNode());
                    flush = true;
                    break;
                }
                case 4: {
                    // special case when boundary close a node with only header.
                    if (this.node && this.node._headerlen && !this.node.headers) {
                        this.node.parseHeaders();
                        this.push(this.node);
                    }
                    // move up to the multipart node this closing delimiter belongs to
                    let parentNode = this.parentMultipartNode();
                    if (parentNode) {
                        this.node = parentNode;
                        // the closing delimiter of this multipart was just processed, so any
                        // later boundary line of this node belongs to the epilogue. A closing
                        // delimiter seen in the preamble (case 2) deliberately does not count.
                        this.inEpilogue = true;
                    }
                    this.state = BODY;
                    break;
                }
            }

            return next(
                null,
                {
                    node: this.node,
                    type: 'data',
                    value: line
                },
                flush
            );
        }

        switch (this.state) {
            case HEAD: {
                this.node.addHeaderChunk(line);
                let headSizeError = this.checkHeadSize();
                if (headSizeError) {
                    return next(headSizeError);
                }
                if (final || (line.length === 1 && line[0] === 0x0a) || (line.length === 2 && line[0] === 0x0d && line[1] === 0x0a)) {
                    let currentNode = this.node;

                    currentNode.parseHeaders();

                    // if the content is attached message then just continue
                    if (
                        currentNode.contentType === 'message/rfc822' &&
                        !this.config.ignoreEmbedded &&
                        (!currentNode.encoding || ['7bit', '8bit', 'binary'].includes(currentNode.encoding)) &&
                        (this.config.defaultInlineEmbedded ? currentNode.disposition !== 'attachment' : currentNode.disposition === 'inline')
                    ) {
                        currentNode.messageNode = true;
                        this.newNode(currentNode);
                        if (currentNode.parentNode) {
                            // the embedded message continues inside its container, so a
                            // delimiter of the container's own parent still applies here
                            this.node._parentBoundary = currentNode.parentNode._boundary;
                            this.node._parentBoundaryOwner = currentNode.parentNode;
                        }
                    } else {
                        if (currentNode.contentType === 'message/rfc822') {
                            currentNode.messageNode = false;
                        }
                        this.state = BODY;
                    }

                    return next(null, currentNode, flush);
                }

                return next();
            }
            case BODY: {
                return next(
                    null,
                    {
                        node: this.node,
                        type: this.node.multipart ? 'data' : 'body',
                        value: line
                    },
                    flush
                );
            }
        }

        next(null, false);
    }

    /**
     * Resolves the multipart node that owns the boundary of the current node, ie. the
     * node a sibling delimiter or a closing delimiter of _parentBoundary refers to.
     *
     * @returns {MimeNodeType | false} Owner of _parentBoundary or false for the root node.
     */
    parentMultipartNode() {
        return this.node._parentBoundaryOwner || false;
    }

    /**
     * @param {MimeNodeType | false} [parent]
     * @returns {void}
     */
    newNode(parent) {
        this.node = /** @type {MimeNodeType} */ (new MimeNode(parent || false, this.config));
        this.state = HEAD;
        this.nodeCounter++;
        // a fresh node starts before its own content, never in an epilogue
        this.inEpilogue = false;
    }
}

module.exports = MessageSplitter;
