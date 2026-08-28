/* eslint no-control-regex: 0 */
'use strict';

const { X509Certificate } = require('crypto');

// Map of certificate subject OIDs to human-readable names
// Includes standard X.509 attributes and VMC-specific trademark OIDs (1.3.6.1.4.1.53087.*)
const SUBJECT_OIDS = {
    // VMC-specific trademark OIDs (BIMI Working Group private enterprise arc)
    '1.3.6.1.4.1.53087.1.2': 'trademarkOfficeName',
    '1.3.6.1.4.1.53087.1.3': 'trademarkCountryOrRegionName',
    '1.3.6.1.4.1.53087.1.4': 'trademarkRegistration',
    '1.3.6.1.4.1.53087.1.5': 'legalEntityIdentifier',
    '1.3.6.1.4.1.53087.1.6': 'wordMark',
    '1.3.6.1.4.1.53087.1.13': 'markType', // Determines VMC vs CMC certificate type
    '1.3.6.1.4.1.53087.4.1': 'pilotIdentifier',
    // Standard X.509 subject attributes
    CN: 'commonName',
    O: 'organizationName',
    OU: 'organizationalUnitName',
    L: 'localityName',
    ST: 'stateOrProvinceName',
    S: 'stateOrProvinceName',
    C: 'countryName',
    jurisdictionC: 'jurisdictionCountryName',
    jurisdictionST: 'jurisdictionStateOrProvinceName',
    jurisdictionL: 'jurisdictionLocalityName'
};

function parsePemBundle(bundle) {
    const normalized = (bundle || '').toString().split(/\r?\n/).join('\x00');
    const matches = normalized.match(/[-]{3,}BEGIN [^-]+[-]{3,}.*?[-]{3,}END [^-]+[-]{3,}/g);
    if (!matches) {
        return null;
    }
    return matches.map(cert => cert.replace(/\x00/g, '\n') + '\n');
}

function getCerts(bundle) {
    const certs = parsePemBundle(bundle);
    if (!certs) {
        return false;
    }

    return certs.map(pem => ({
        pem,
        cert: new X509Certificate(pem)
    }));
}

function getDateString(date) {
    if (!date) {
        return null;
    }

    if (typeof date === 'string') {
        const parsed = new Date(date);
        return parsed.toString() !== 'Invalid Date' ? parsed.toISOString() : date;
    }

    if (typeof date.toISOString === 'function') {
        return date.toISOString();
    }

    if (typeof date.toString === 'function') {
        return date.toString();
    }

    return null;
}

function parseSubjectLine(line) {
    const separatorPos = line.indexOf('=');
    if (separatorPos < 0) {
        return null;
    }

    const rawKey = line.substring(0, separatorPos);
    const key = SUBJECT_OIDS[rawKey] || rawKey;
    let value = line.substring(separatorPos + 1).replace(/\\,/g, ',');

    if (value.startsWith('"')) {
        try {
            value = JSON.parse(value);
        } catch {
            // keep original value
        }
    }

    return [key, value];
}

function parseSubject(subject) {
    const lines = (subject || '').split(/\r?\n/);
    const entries = lines.map(parseSubjectLine).filter(Boolean);
    return Object.fromEntries(entries);
}

module.exports = { parsePemBundle, getCerts, getDateString, parseSubject };
