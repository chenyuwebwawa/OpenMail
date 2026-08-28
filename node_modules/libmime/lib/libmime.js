/* eslint no-control-regex: 0, no-div-regex: 0, quotes: 0 */
'use strict';

const { Buffer } = require('node:buffer');
const libcharset = require('./charset');
const libbase64 = require('libbase64');
const libqp = require('libqp');
const mimetypes = require('./mimetypes');

const STAGE_KEY = 0x1001;
const STAGE_VALUE = 0x1002;

// Sets an own property on a plain object. A regular assignment with a
// '__proto__' key would silently modify the object's prototype instead of
// creating an own property, so it needs special handling.
const setOwnProperty = (obj, key, value) => {
    if (key === '__proto__') {
        Object.defineProperty(obj, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true
        });
    } else {
        obj[key] = value;
    }
};

// Checks own properties only, as attacker controlled keys like '__proto__'
// or 'toString' would otherwise resolve to inherited Object.prototype members.
// NB! Not named hasOwnProperty, that would shadow the global builtin
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Whitespace that separates the tokens of a header value. Kept as a char comparison,
// a regex test would be run for every single char of every parsed header
const isWSP = chr => chr === ' ' || chr === '\t' || chr === '\r' || chr === '\n' || chr === '\f' || chr === '\v';

class Libmime {
    constructor(config) {
        this.config = config || {};
    }

    /**
     * Checks if a value is plaintext string (uses only printable 7bit chars)
     *
     * @param {String} value String to be tested
     * @returns {Boolean} true if it is a plaintext string
     */
    isPlainText(value) {
        if (typeof value !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\u0080-\uFFFF]/.test(value)) {
            return false;
        } else {
            return true;
        }
    }

    /**
     * Checks if a multi line string containes lines longer than the selected value.
     *
     * Useful when detecting if a mail message needs any processing at all –
     * if only plaintext characters are used and lines are short, then there is
     * no need to encode the values in any way. If the value is plaintext but has
     * longer lines then allowed, then use format=flowed
     *
     * @param {String} str String to be tested
     * @param {Number} lineLength Max line length to check for
     * @returns {Boolean} Returns true if there is at least one line longer than lineLength chars
     */
    hasLongerLines(str, lineLength) {
        return new RegExp('^.{' + (lineLength + 1) + ',}', 'm').test(str);
    }

    /**
     * Decodes a string from a format=flowed soft wrapping.
     *
     * @param {String} str Plaintext string with format=flowed to decode
     * @param {Boolean} [delSp] If true, delete leading spaces (delsp=yes)
     * @return {String} Mime decoded string
     */
    decodeFlowed(str, delSp) {
        str = (str || '').toString();

        let lines = str.split(/\r?\n/);

        let result = [],
            buffer = null;

        // remove soft linebreaks
        // soft linebreaks are added after space symbols
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            let isSoftBreak = buffer !== null && / $/.test(buffer) && !/(^|\n)-- $/.test(buffer);

            if (isSoftBreak) {
                if (delSp) {
                    // delsp adds space to text to be able to fold it
                    // these spaces can be removed once the text is unfolded
                    buffer = buffer.slice(0, -1) + line;
                } else {
                    buffer += line;
                }
            } else {
                if (buffer !== null) {
                    result.push(buffer);
                }

                buffer = line;
            }
        }

        if (buffer) {
            result.push(buffer);
        }

        // remove whitespace stuffing
        // http://tools.ietf.org/html/rfc3676#section-4.4
        return result.join('\n').replace(/^ /gm, '');
    }

    /**
     * Adds soft line breaks to content marked with format=flowed to
     * ensure that no line in the message is never longer than lineLength
     *
     * @param {String} str Plaintext string that requires wrapping
     * @param {Number} [lineLength=76] Maximum length of a line
     * @return {String} String with forced line breaks
     */
    encodeFlowed(str, lineLength) {
        lineLength = lineLength || 76;

        let flowed = [];
        str.split(/\r?\n/).forEach(line => {
            flowed.push(
                this.foldLines(
                    line
                        // space stuffing http://tools.ietf.org/html/rfc3676#section-4.2
                        .replace(/^( |From|>)/gim, ' $1'),
                    lineLength,
                    true
                )
            );
        });
        return flowed.join('\r\n');
    }

    /**
     * Encodes a string or an Buffer to an UTF-8 MIME Word (rfc2047)
     *
     * @param {String|Buffer} data String to be encoded
     * @param {String} mimeWordEncoding='Q' Encoding for the mime word, either Q or B
     * @param {Number} [maxLength=0] If set, split mime words into several chunks if needed
     * @return {String} Single or several mime words joined together
     */
    encodeWord(data, mimeWordEncoding, maxLength) {
        mimeWordEncoding = (mimeWordEncoding || 'Q').toString().toUpperCase().trim().charAt(0);
        maxLength = maxLength || 0;

        let encodedStr;
        let toCharset = 'UTF-8';

        if (maxLength && maxLength > 7 + toCharset.length) {
            maxLength -= 7 + toCharset.length;
        }

        if (mimeWordEncoding === 'Q') {
            // https://tools.ietf.org/html/rfc2047#section-5 rule (3)
            encodedStr = libqp.encode(data).replace(/[^a-z0-9!*+\-/=]/gi, chr => {
                let ord = chr.charCodeAt(0).toString(16).toUpperCase();
                if (chr === ' ') {
                    return '_';
                } else {
                    return '=' + (ord.length === 1 ? '0' + ord : ord);
                }
            });
        } else if (mimeWordEncoding === 'B') {
            encodedStr = typeof data === 'string' ? data : libbase64.encode(data);
            maxLength = maxLength ? Math.max(3, ((maxLength - (maxLength % 4)) / 4) * 3) : 0;
        }

        if (maxLength && (mimeWordEncoding !== 'B' ? encodedStr : libbase64.encode(data)).length > maxLength) {
            if (mimeWordEncoding === 'Q') {
                encodedStr = this.splitMimeEncodedString(encodedStr, maxLength).join('?= =?' + toCharset + '?' + mimeWordEncoding + '?');
            } else {
                // RFC2047 6.3 (2) states that encoded-word must include an integral number of characters, so no chopping unicode sequences
                let parts = [];
                let lpart = '';
                for (let i = 0, len = encodedStr.length; i < len; i++) {
                    let chr = encodedStr.charAt(i);
                    // check if we can add this character to the existing string
                    // without breaking byte length limit

                    if (/[\ud83c\ud83d\ud83e]/.test(chr) && i < len - 1) {
                        // composite emoji byte, so add the next byte as well
                        chr += encodedStr.charAt(++i);
                    }

                    if (Buffer.byteLength(lpart + chr) <= maxLength || i === 0) {
                        lpart += chr;
                    } else {
                        // we hit the length limit, so push the existing string and start over
                        parts.push(libbase64.encode(lpart));
                        lpart = chr;
                    }
                }
                if (lpart) {
                    parts.push(libbase64.encode(lpart));
                }

                if (parts.length > 1) {
                    encodedStr = parts.join('?= =?' + toCharset + '?' + mimeWordEncoding + '?');
                } else {
                    encodedStr = parts.join('');
                }
            }
        } else if (mimeWordEncoding === 'B') {
            encodedStr = libbase64.encode(data);
        }

        return '=?' + toCharset + '?' + mimeWordEncoding + '?' + encodedStr + (encodedStr.substr(-2) === '?=' ? '' : '?=');
    }

    /**
     * Normalizes a charset name to its canonical form, resolving common aliases and
     * invalid names. For example `iso-8859-8-i` and `iso-8859-8-e` become `ISO-8859-8`
     * and `win-1257` becomes `windows-1257`. Unknown charsets are returned uppercased.
     * Missing or non-string input defaults to `UTF-8`.
     *
     * @param {String} charset Charset name to normalize
     * @return {String} Canonical charset name
     */
    normalizeCharset(charset) {
        return libcharset.normalizeCharset(charset);
    }

    /**
     * Decodes the inner payload of a single mime encoded-word into a unicode string.
     * Expects the three components of `=?charset?encoding?text?=` already separated.
     *
     * @param {String} charset Charset name from the encoded-word (may include an RFC 2231 language tag, which is ignored)
     * @param {String} encoding Encoding indicator, either 'Q' or 'B' (case insensitive)
     * @param {String} str Encoded payload between the second `?` and the trailing `?=`
     * @return {String} Decoded unicode string
     */
    decodeWord(charset, encoding, str) {
        // RFC2231 added language tag to the encoding
        // see: https://tools.ietf.org/html/rfc2231#section-5
        // this implementation silently ignores this tag
        let splitPos = charset.indexOf('*');
        if (splitPos >= 0) {
            charset = charset.substr(0, splitPos);
        }
        charset = libcharset.normalizeCharset(charset);

        encoding = encoding.toUpperCase();

        if (encoding === 'Q') {
            str = str
                // remove spaces between = and hex char, this might indicate invalidly applied line splitting
                .replace(/=\s+([0-9a-fA-F])/g, '=$1')
                // convert all underscores to spaces
                .replace(/[_\s]/g, ' ');

            let buf = Buffer.from(str);
            let bytes = [];
            for (let i = 0, len = buf.length; i < len; i++) {
                let c = buf[i];
                if (i <= len - 2 && c === 0x3d /* = */) {
                    let c1 = this.getHex(buf[i + 1]);
                    let c2 = this.getHex(buf[i + 2]);
                    if (c1 && c2) {
                        let c = parseInt(c1 + c2, 16);
                        bytes.push(c);
                        i += 2;
                        continue;
                    }
                }
                bytes.push(c);
            }
            str = Buffer.from(bytes);
        } else if (encoding === 'B') {
            str = Buffer.concat(
                str
                    .split('=')
                    .filter(s => s !== '') // filter empty string
                    .map(str => Buffer.from(str, 'base64'))
            );
        } else {
            // keep as is, convert Buffer to unicode string, assume utf8
            str = Buffer.from(str);
        }

        return libcharset.decode(str, charset);
    }

    /**
     * Finds word sequences with non ascii text and converts these to mime words
     *
     * @param {String|Buffer} data String to be encoded
     * @param {String} mimeWordEncoding='Q' Encoding for the mime word, either Q or B
     * @param {Number} [maxLength=0] If set, split mime words into several chunks if needed
     * @param {String} [fromCharset='UTF-8'] Source character set
     * @return {String} String with possible mime words
     */
    encodeWords(data, mimeWordEncoding, maxLength, fromCharset) {
        if (!fromCharset && typeof maxLength === 'string' && !maxLength.match(/^[0-9]+$/)) {
            fromCharset = maxLength;
            maxLength = undefined;
        }

        maxLength = maxLength || 0;

        let decodedValue = libcharset.decode(libcharset.convert(data || '', fromCharset));
        let encodedValue;

        let firstMatch = decodedValue.match(/(?:^|\s)([^\s]*[\u0080-\uFFFF])/);
        if (!firstMatch) {
            return decodedValue;
        }
        let lastMatch = decodedValue.match(/([\u0080-\uFFFF][^\s]*)[^\u0080-\uFFFF]*$/);
        if (!lastMatch) {
            // should not happen
            return decodedValue;
        }
        let startIndex =
            firstMatch.index +
            (
                firstMatch[0].match(/[^\s]/) || {
                    index: 0
                }
            ).index;
        let endIndex = lastMatch.index + (lastMatch[1] || '').length;

        encodedValue =
            (startIndex ? decodedValue.substr(0, startIndex) : '') +
            this.encodeWord(decodedValue.substring(startIndex, endIndex), mimeWordEncoding || 'Q', maxLength) +
            (endIndex < decodedValue.length ? decodedValue.substr(endIndex) : '');

        return encodedValue;
    }

    /**
     * Decode a string that might include one or several mime words
     *
     * @param {String} str String including some mime words that will be decoded
     * @return {String} Decoded unicode string
     */
    decodeWords(str) {
        return (
            (str || '')
                .toString()
                // find base64 words that can be joined
                .replace(/(=\?([^?]+)\?[Bb]\?[^?]*\?=)\s*(?==\?([^?]+)\?[Bb]\?[^?]*\?=)/g, (match, left, chLeft, chRight) => {
                    // only mark b64 chunks to be joined if charsets match
                    if (libcharset.normalizeCharset(chLeft || '') === libcharset.normalizeCharset(chRight || '')) {
                        // set a joiner marker
                        return left + '__\x00JOIN\x00__';
                    }
                    return match;
                })
                // find QP words that can be joined
                .replace(/(=\?([^?]+)\?[Qq]\?[^?]*\?=)\s*(?==\?([^?]+)\?[Qq]\?[^?]*\?=)/g, (match, left, chLeft, chRight) => {
                    // only mark QP chunks to be joined if charsets match
                    if (libcharset.normalizeCharset(chLeft || '') === libcharset.normalizeCharset(chRight || '')) {
                        // set a joiner marker
                        return left + '__\x00JOIN\x00__';
                    }
                    return match;
                })
                // join base64 encoded words
                .replace(/(\?=)?__\x00JOIN\x00__(=\?([^?]+)\?[QqBb]\?)?/g, '')
                // remove spaces between mime encoded words
                .replace(/(=\?[^?]+\?[QqBb]\?[^?]*\?=)\s+(?==\?[^?]+\?[QqBb]\?[^?]*\?=)/g, '$1')
                // decode words
                .replace(/=\?([\w_\-*]+)\?([QqBb])\?([^?]*)\?=/g, (m, charset, encoding, text) => this.decodeWord(charset, encoding, text))
        );
    }

    getHex(c) {
        if ((c >= 0x30 /* 0 */ && c <= 0x39) /* 9 */ || (c >= 0x61 /* a */ && c <= 0x66) /* f */ || (c >= 0x41 /* A */ && c <= 0x46) /* F */) {
            return String.fromCharCode(c);
        }
        return false;
    }

    /**
     * Splits a string by :
     * The result is not mime word decoded, you need to do your own decoding based
     * on the rules for the specific header key
     *
     * @param {String} headerLine Single header line, might include linebreaks as well if folded
     * @return {Object} An object of {key, value}
     */
    decodeHeader(headerLine) {
        let line = (headerLine || '')
                .toString()
                .replace(/(?:\r?\n|\r)[ \t]*/g, ' ')
                .trim(),
            match = line.match(/^\s*([^:]+):(.*)$/),
            key = ((match && match[1]) || '').trim().toLowerCase(),
            value = ((match && match[2]) || '').trim();

        return {
            key,
            value
        };
    }

    /**
     * Parses a block of header lines. Does not decode mime words as every
     * header might have its own rules (eg. formatted email addresses and such)
     *
     * @param {String} headers Headers string
     * @return {Object} An object of headers, where header keys are object keys and every value is an Array of the values for that key
     */
    decodeHeaders(headers) {
        let lines = headers.split(/\r?\n|\r/),
            headersObj = {},
            header,
            i,
            len;

        // Empty lines in front of the block are not part of any header, a caller might
        // include the line break that separates a mime part boundary from its headers
        let headersPos = 0;
        while (headersPos < lines.length && lines[headersPos] === '') {
            headersPos++;
        }

        // An empty line terminates the header block, anything after it is the message body.
        // Without this a body line that starts with whitespace would be folded into the last header
        let bodyPos = lines.indexOf('', headersPos);
        lines = lines.slice(headersPos, bodyPos >= 0 ? bodyPos : lines.length);

        // unfold folded lines, a continuation line always starts with a space or a tab
        for (i = lines.length - 1; i > 0; i--) {
            if (/^[ \t]/.test(lines[i])) {
                lines[i - 1] += '\r\n' + lines[i];
                lines.splice(i, 1);
            }
        }

        for (i = 0, len = lines.length; i < len; i++) {
            header = this.decodeHeader(lines[i]);
            if (!hasOwn(headersObj, header.key)) {
                setOwnProperty(headersObj, header.key, [header.value]);
            } else {
                headersObj[header.key].push(header.value);
            }
        }

        return headersObj;
    }

    /**
     * Joins parsed header value together as 'value; param1=value1; param2=value2'
     * PS: We are following RFC 822 for the list of special characters that we need to keep in quotes.
     *      Refer: https://www.w3.org/Protocols/rfc1341/4_Content-Type.html
     * @param {Object} structured Parsed header value
     * @return {String} joined header value
     */
    buildHeaderValue(structured) {
        let paramsArray = [];

        Object.keys(structured.params || {}).forEach(param => {
            // filename might include unicode characters so it is a special case
            let value = structured.params[param];
            if (!this.isPlainText(value) || value.length >= 75) {
                this.buildHeaderParam(param, value, 50).forEach(encodedParam => {
                    if (!/[\s"\\;:/=(),<>@[\]?]|^[-']|'$/.test(encodedParam.value) || encodedParam.key.substr(-1) === '*') {
                        paramsArray.push(encodedParam.key + '=' + encodedParam.value);
                    } else {
                        paramsArray.push(encodedParam.key + '=' + JSON.stringify(encodedParam.value));
                    }
                });
            } else if (/[\s'"\\;:/=(),<>@[\]?]|^-/.test(value)) {
                paramsArray.push(param + '=' + JSON.stringify(value));
            } else {
                paramsArray.push(param + '=' + value);
            }
        });

        return structured.value + (paramsArray.length ? '; ' + paramsArray.join('; ') : '');
    }

    /**
     * Parses a header value with key=value arguments into a structured
     * object.
     *
     *   parseHeaderValue('text/plain; CHARSET=UTF-8') ->
     *   {
     *     'value': 'text/plain',
     *     'params': {
     *       'charset': 'UTF-8'
     *     }
     *   }
     *
     * @param {String} str Header value
     * @return {Object} Header value as a parsed structure
     */
    parseHeaderValue(str) {
        let response = {
            value: false,
            params: {}
        };
        let key = false;
        let value = '';
        // Length of the significant part of `value`. Whitespace outside of quotes is
        // not part of the value, while whitespace inside quotes is (rfc2045 section 5.1)
        let valueEnd = 0;
        let stage = STAGE_VALUE;

        let quote = false;
        let escaped = false;
        let chr;

        // Stores the collected value, either as the default value, as the value for the
        // current key, or as a key that has no value at all. Runs once per parameter
        let commit = () => {
            let collected = value.substring(0, valueEnd);
            value = '';
            valueEnd = 0;

            if (stage === STAGE_KEY) {
                // key without a value, see emptykey:
                // Header-Key: somevalue; key=value; emptykey
                if (collected) {
                    setOwnProperty(response.params, collected.toLowerCase(), '');
                }
            } else if (key === false) {
                // default value
                response.value = collected;
            } else {
                // subkey value
                setOwnProperty(response.params, key, collected);
            }
        };

        for (let i = 0, len = str.length; i < len; i++) {
            chr = str.charAt(i);
            switch (stage) {
                case STAGE_KEY:
                    if (chr === '=') {
                        key = value.substring(0, valueEnd).toLowerCase();
                        value = '';
                        valueEnd = 0;
                        stage = STAGE_VALUE;
                    } else if (chr === ';') {
                        // key without a value, eg. the "inline" in "attachment; inline; filename=a.txt"
                        commit();
                    } else if (isWSP(chr)) {
                        if (value.length) {
                            value += chr;
                        }
                    } else {
                        value += chr;
                        valueEnd = value.length;
                    }
                    break;
                case STAGE_VALUE:
                    if (escaped) {
                        value += chr;
                        valueEnd = value.length;
                    } else if (chr === '\\') {
                        escaped = true;
                        continue;
                    } else if (chr === '"') {
                        // every char between the quotes is significant, including whitespace
                        quote = !quote;
                    } else if (!quote && chr === ';') {
                        commit();
                        stage = STAGE_KEY;
                    } else if (!quote && isWSP(chr)) {
                        if (value.length) {
                            value += chr;
                        }
                    } else {
                        value += chr;
                        valueEnd = value.length;
                    }
                    escaped = false;
                    break;
            }
        }

        // finalize remainder
        commit();

        // handle parameter value continuations
        // https://tools.ietf.org/html/rfc2231#section-3

        // Collect the segments of every continuation parameter. These are kept out of
        // response.params so that a half assembled value can not leak into the result
        let continuations = new Map();

        for (let key of Object.keys(response.params)) {
            let match = key.match(/\*((\d+)\*?)?$/);

            if (!match) {
                // nothing to do here, does not seem like a continuation param
                continue;
            }

            let actualKey = key.substr(0, match.index).toLowerCase();
            let nr = Number(match[2]) || 0;
            let value = response.params[key];

            // remove the old reference
            delete response.params[key];

            let continuation = continuations.get(actualKey);
            if (!continuation) {
                continuation = {
                    charset: false,
                    values: []
                };
                continuations.set(actualKey, continuation);
            }

            if (nr === 0 && match[0].charAt(match[0].length - 1) === '*' && (match = value.match(/^([^']*)'[^']*'(.*)$/))) {
                continuation.charset = match[1] || 'utf-8';
                value = match[2];
            }

            continuation.values.push({ nr, value });
        }

        // concatenate the split rfc2231 strings and decode the encoded ones
        for (let [key, continuation] of continuations) {
            // NB! An assembled continuation always overrides a plain parameter with the same
            // name, in either source order. The plain form is the legacy ascii fallback of the
            // extended one, so rfc6266 section 4.3 requires picking the extended value. Letting
            // the fallback win would make libmime disagree with the mail clients that follow it
            let value = continuation.values
                .sort((a, b) => a.nr - b.nr)
                .map(val => val.value)
                .join('');

            if (!continuation.charset) {
                setOwnProperty(response.params, key, this.decodeWords(value));
                continue;
            }

            // convert "%AB" to the quoted printable "=AB" and decode it as the charset of the parameter.
            // NB! The charset is passed in as an argument instead of building a "=?charset?Q?=AB?=" string,
            // a charset that contains "?" would otherwise inject an encoded word of its own
            let qpValue = value
                // fix invalidly encoded chars
                .replace(/[=_\s]/g, s => {
                    if (s === ' ') {
                        return '_';
                    }
                    let c = s.charCodeAt(0).toString(16);
                    return '%' + (c.length < 2 ? '0' : '') + c;
                })
                // change from urlencoding to percent encoding
                .replace(/%/g, '=');

            setOwnProperty(response.params, key, this.decodeWord(continuation.charset, 'Q', qpValue));
        }

        return response;
    }

    /**
     * Encodes a string or an Buffer to an UTF-8 Parameter Value Continuation encoding (rfc2231)
     * Useful for splitting long parameter values.
     *
     * For example
     *      title="unicode string"
     * becomes
     *     title*0*=utf-8''unicode
     *     title*1*=%20string
     *
     * @param {String} key Parameter name (eg. 'filename')
     * @param {String|Buffer} data String to be encoded
     * @param {Number} [maxLength=50] Max length for generated chunks
     * @param {String} [fromCharset='UTF-8'] Source character set
     * @return {Array} A list of encoded keys and headers
     */
    buildHeaderParam(key, data, maxLength, fromCharset) {
        let list = [];

        if (typeof data !== 'string' && !Buffer.isBuffer(data)) {
            // documented input is a string or a Buffer, normalize anything else
            data = data === null || data === undefined ? '' : data.toString();
        }

        let encodedStr = typeof data === 'string' ? data : libcharset.decode(data, fromCharset);
        let encodedStrArr;
        let chr, ord;
        let line;
        let startPos = 0;
        let isEncoded = false;
        let i, len;

        maxLength = maxLength || 50;

        // process ascii only text
        if (this.isPlainText(data)) {
            // check if conversion is even needed
            if (encodedStr.length <= maxLength) {
                return [
                    {
                        key,
                        value: encodedStr
                    }
                ];
            }

            encodedStr = encodedStr.replace(new RegExp('.{' + maxLength + '}', 'g'), str => {
                list.push({
                    line: str
                });
                return '';
            });

            if (encodedStr) {
                list.push({
                    line: encodedStr
                });
            }
        } else {
            if (/[\uD800-\uDBFF]/.test(encodedStr)) {
                // string containts surrogate pairs, so normalize it to an array of bytes
                encodedStrArr = [];
                for (i = 0, len = encodedStr.length; i < len; i++) {
                    chr = encodedStr.charAt(i);
                    ord = chr.charCodeAt(0);
                    if (ord >= 0xd800 && ord <= 0xdbff && i < len - 1) {
                        chr += encodedStr.charAt(i + 1);
                        encodedStrArr.push(chr);
                        i++;
                    } else {
                        encodedStrArr.push(chr);
                    }
                }
                encodedStr = encodedStrArr;
            }

            // first line includes the charset and language info and needs to be encoded
            // even if it does not contain any unicode characters
            line = "utf-8''";
            isEncoded = true;
            startPos = 0;

            // process text with unicode or special chars
            for (i = 0, len = encodedStr.length; i < len; i++) {
                chr = encodedStr[i];

                if (isEncoded) {
                    chr = this.safeEncodeURIComponent(chr);
                } else {
                    // try to urlencode current char
                    chr = chr === ' ' ? chr : this.safeEncodeURIComponent(chr);
                    // By default it is not required to encode a line, the need
                    // only appears when the string contains unicode or special chars
                    // in this case we start processing the line over and encode all chars
                    if (chr !== encodedStr[i]) {
                        // Check if it is even possible to add the encoded char to the line
                        // If not, there is no reason to use this line, just push it to the list
                        // and start a new line with the char that needs encoding
                        if ((this.safeEncodeURIComponent(line) + chr).length >= maxLength) {
                            list.push({
                                line,
                                encoded: isEncoded
                            });
                            line = '';
                            startPos = i - 1;
                        } else {
                            isEncoded = true;
                            i = startPos;
                            line = '';
                            continue;
                        }
                    }
                }

                // if the line is already too long, push it to the list and start a new one
                if ((line + chr).length >= maxLength) {
                    list.push({
                        line,
                        encoded: isEncoded
                    });
                    line = chr = encodedStr[i] === ' ' ? ' ' : this.safeEncodeURIComponent(encodedStr[i]);
                    if (chr === encodedStr[i]) {
                        isEncoded = false;
                        startPos = i - 1;
                    } else {
                        isEncoded = true;
                    }
                } else {
                    line += chr;
                }
            }

            if (line) {
                list.push({
                    line,
                    encoded: isEncoded
                });
            }
        }

        return list.map((item, i) => ({
            // encoded lines: {name}*{part}*
            // unencoded lines: {name}*{part}
            // if any line needs to be encoded then the first line (part==0) is always encoded
            key: key + '*' + i + (item.encoded ? '*' : ''),
            value: item.line
        }));
    }

    /**
     * Returns file extension for a content type string. If no suitable extensions
     * are found, 'bin' is used as the default extension
     *
     * @param {String} mimeType Content type to be checked for
     * @return {String} File extension
     */
    detectExtension(mimeType) {
        mimeType = (mimeType || '').toString().toLowerCase().replace(/\s/g, '');
        if (!hasOwn(mimetypes.list, mimeType)) {
            return 'bin';
        }

        if (typeof mimetypes.list[mimeType] === 'string') {
            return mimetypes.list[mimeType];
        }

        let mimeParts = mimeType.split('/');

        // search for name match
        for (let i = 0, len = mimetypes.list[mimeType].length; i < len; i++) {
            if (mimeParts[1] === mimetypes.list[mimeType][i]) {
                return mimetypes.list[mimeType][i];
            }
        }

        // use the first one
        return mimetypes.list[mimeType][0] !== '*' ? mimetypes.list[mimeType][0] : 'bin';
    }

    /**
     * Returns content type for a file extension. If no suitable content types
     * are found, 'application/octet-stream' is used as the default content type
     *
     * @param {String} extension Extension (or filename) to be checked for
     * @return {String} Content type
     */
    detectMimeType(extension) {
        extension = (extension || '').toString().toLowerCase().replace(/\s/g, '').replace(/^\./g, '').split('.').pop();

        if (!hasOwn(mimetypes.extensions, extension)) {
            return 'application/octet-stream';
        }

        if (typeof mimetypes.extensions[extension] === 'string') {
            return mimetypes.extensions[extension];
        }

        let mimeParts;

        // search for name match
        for (let i = 0, len = mimetypes.extensions[extension].length; i < len; i++) {
            mimeParts = mimetypes.extensions[extension][i].split('/');
            if (mimeParts[1] === extension) {
                return mimetypes.extensions[extension][i];
            }
        }

        // use the first one
        return mimetypes.extensions[extension][0];
    }

    /**
     * Folds long lines, useful for folding header lines (afterSpace=false) and
     * flowed text (afterSpace=true)
     *
     * @param {String} str String to be folded
     * @param {Number} [lineLength=76] Maximum length of a line
     * @param {Boolean} afterSpace If true, leave a space in the end of a line
     * @return {String} String with folded lines
     */
    foldLines(str, lineLength, afterSpace) {
        str = (str || '').toString();
        lineLength = lineLength || 76;

        let pos = 0,
            len = str.length,
            result = '',
            line,
            match;

        while (pos < len) {
            line = str.substr(pos, lineLength);
            if (line.length < lineLength) {
                result += line;
                break;
            }
            if ((match = line.match(/^[^\n\r]*(\r?\n|\r)/))) {
                line = match[0];
                result += line;
                pos += line.length;
                continue;
            } else if ((match = line.match(/(\s+)[^\s]*$/)) && match[0].length - (afterSpace ? (match[1] || '').length : 0) < line.length) {
                line = line.substr(0, line.length - (match[0].length - (afterSpace ? (match[1] || '').length : 0)));
            } else if ((match = str.substr(pos + line.length).match(/^[^\s]+(\s*)/))) {
                line = line + match[0].substr(0, match[0].length - (!afterSpace ? (match[1] || '').length : 0));
            }

            result += line;
            pos += line.length;
            if (pos < len) {
                result += '\r\n';
            }
        }

        return result;
    }

    /**
     * Splits a mime encoded string. Needed for dividing mime words into smaller chunks
     *
     * @param {String} str Mime encoded string to be split up
     * @param {Number} maxlen Maximum length of characters for one part (minimum 12)
     * @return {Array} Split string
     */
    splitMimeEncodedString(str, maxlen) {
        let curLine,
            match,
            chr,
            done,
            lines = [];

        // require at least 12 symbols to fit possible 4 octet UTF-8 sequences
        maxlen = Math.max(maxlen || 0, 12);

        while (str.length) {
            curLine = str.substr(0, maxlen);

            // move incomplete escaped char back to main
            if ((match = curLine.match(/[=][0-9A-F]?$/i))) {
                curLine = curLine.substr(0, match.index);
            }

            done = false;
            while (!done) {
                done = true;
                // check if not middle of a unicode char sequence
                if ((match = str.substr(curLine.length).match(/^[=]([0-9A-F]{2})/i))) {
                    chr = parseInt(match[1], 16);
                    // invalid sequence, move one char back anc recheck
                    if (chr < 0xc2 && chr > 0x7f) {
                        curLine = curLine.substr(0, curLine.length - 3);
                        done = false;
                    }
                }
            }

            if (curLine.length) {
                lines.push(curLine);
            }
            str = str.substr(curLine.length);
        }

        return lines;
    }

    encodeURICharComponent(chr) {
        let res = '';
        // percent encoding is defined over bytes, so encode the char as UTF-8 first
        let buf = Buffer.from(chr, 'utf-8');

        for (let i = 0, len = buf.length; i < len; i++) {
            let ord = buf[i].toString(16).toUpperCase();
            res += '%' + (ord.length < 2 ? '0' : '') + ord;
        }

        return res;
    }

    safeEncodeURIComponent(str) {
        str = (str || '').toString();

        try {
            // might throw if we try to encode invalid sequences, eg. partial emoji
            str = encodeURIComponent(str);
        } catch (E) {
            // should never run
            return str.replace(/[^\x00-\x1F *'()<>@,;:\\"[\]?=\u007F-\uFFFF]+/g, '');
        }

        // ensure chars that are not handled by encodeURICompent are converted as well
        return str.replace(/[\x00-\x1F *'()<>@,;:\\"[\]?=\u007F-\uFFFF]/g, chr => this.encodeURICharComponent(chr));
    }
}

module.exports = new Libmime();
module.exports.Libmime = Libmime;
