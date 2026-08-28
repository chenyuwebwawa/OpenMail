'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { AsnParser } = require('@peculiar/asn1-schema');
const { LogotypeExtn } = require('@peculiar/asn1-x509-logotype');
const { Certificate } = require('@peculiar/asn1-x509');

const gunzip = promisify(zlib.gunzip);

// Logotype extension OID (RFC 3709) - contains embedded logo data in VMC certificates
const LOGOTYPE_EXTENSION_OID = '1.3.6.1.5.5.7.1.12';

// Map of hash algorithm OIDs to Node.js crypto algorithm names
const HASH_ALGORITHMS = {
    '1.3.14.3.2.26': 'sha1',
    '2.16.840.1.101.3.4.2.4': 'sha224',
    '2.16.840.1.101.3.4.2.1': 'sha256',
    '2.16.840.1.101.3.4.2.2': 'sha384',
    '2.16.840.1.101.3.4.2.3': 'sha512',
    '2.16.840.1.101.3.4.2.5': 'sha512-224',
    '2.16.840.1.101.3.4.2.6': 'sha512-256'
};

function parseDataUrl(url) {
    if (!url.startsWith('data:')) {
        return {};
    }

    const commaPos = url.indexOf(',');
    if (commaPos < 0) {
        return {};
    }

    const header = url.substring(5, commaPos);
    const content = url.substring(commaPos + 1);
    const parts = header.split(';');
    const mediaType = parts.shift() || '';
    const base64 = parts.shift() === 'base64';

    return { header, content, mediaType, base64 };
}

function extractHashInfo(imageDetails) {
    const hashObject = imageDetails.logotypeHash?.[0];
    if (!hashObject) {
        return { hashAlgo: undefined, hashValue: undefined };
    }

    const hashAlgoOid = hashObject.hashAlg?.algorithm;
    const hashAlgo = hashAlgoOid ? HASH_ALGORITHMS[hashAlgoOid] : undefined;
    const hashValue = hashObject.hashValue?.buffer ? Buffer.from(hashObject.hashValue.buffer) : undefined;

    return { hashAlgo, hashValue };
}

async function extractLogoFile(imageDetails) {
    const logotypeURI = imageDetails.logotypeURI?.[0];
    if (!logotypeURI) {
        return undefined;
    }

    const { content, base64 } = parseDataUrl(logotypeURI);
    if (!content) {
        return undefined;
    }

    const data = base64 ? Buffer.from(content, 'base64') : content;
    return gunzip(data);
}

function validateHash(logoFile, hashAlgo, hashValue) {
    if (!logoFile || !hashAlgo || !hashValue) {
        return undefined;
    }

    try {
        const hasher = crypto.createHash(hashAlgo);
        return hashValue.equals(hasher.update(logoFile).digest());
    } catch {
        return undefined;
    }
}

async function parseVMC(buf) {
    const cert = AsnParser.parse(buf, Certificate);
    const logoExtension = cert.tbsCertificate.extensions.find(ext => ext.extnID === LOGOTYPE_EXTENSION_OID);

    if (!logoExtension?.extnValue) {
        const error = new Error('Invalid or missing logotype extension in the certificate');
        error.code = 'INVALID_LOGOTYPE_EXT';
        throw error;
    }

    const logo = AsnParser.parse(logoExtension.extnValue, LogotypeExtn);
    const imageDetails = logo.subjectLogo?.direct?.image?.[0]?.imageDetails;

    if (!imageDetails) {
        const error = new Error('Invalid or missing logotype extension in the certificate');
        error.code = 'INVALID_LOGOTYPE_EXT';
        throw error;
    }

    const { hashAlgo, hashValue } = extractHashInfo(imageDetails);
    const logoFile = await extractLogoFile(imageDetails);
    const validHash = validateHash(logoFile, hashAlgo, hashValue);

    return {
        mediaType: imageDetails.mediaType,
        hashAlgo,
        hashValue,
        logoFile,
        validHash
    };
}

module.exports = { parseVMC };
