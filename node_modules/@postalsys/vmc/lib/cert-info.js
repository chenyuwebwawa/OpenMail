'use strict';

const { getDateString, parseSubject } = require('./tools');

function parseSubjectAltName(subjectAltName) {
    return (subjectAltName || '')
        .split(/^DNS:|,\s*DNS:/g)
        .map(name => name.trim())
        .filter(Boolean);
}

function certInfo(cert) {
    return {
        subject: parseSubject(cert.subject),
        subjectAltName: parseSubjectAltName(cert.subjectAltName),
        fingerprint: cert.fingerprint,
        serialNumber: cert.serialNumber,
        validFrom: getDateString(cert.validFrom),
        validTo: getDateString(cert.validTo),
        issuer: parseSubject(cert.issuer)
    };
}

module.exports = { certInfo };
