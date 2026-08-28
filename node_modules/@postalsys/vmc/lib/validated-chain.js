'use strict';

const { getDateString, parseSubject } = require('./tools');

// BIMI Extended Key Usage OID (id-kp-BrandIndicatorforMessageIdentification)
// Required for VMC certificates per BIMI specification
const BIMI_EXT_KEY_USAGE_OID = '1.3.6.1.5.5.7.3.31';

function parseSubjectAltName(subjectAltName) {
    return (subjectAltName || '')
        .split(/^DNS:|,\s*DNS:/g)
        .map(subject => subject.trim())
        .filter(Boolean);
}

function formatCertError(cert, message, code, meta) {
    const error = new Error(message);
    error.code = code;
    error.details = {
        ...meta,
        certificate: {
            subject: parseSubject(cert.subject),
            subjectAltName: parseSubjectAltName(cert.subjectAltName),
            fingerprint: cert.fingerprint,
            serialNumber: cert.serialNumber,
            validFrom: getDateString(cert.validFrom),
            validTo: getDateString(cert.validTo),
            issuer: parseSubject(cert.issuer)
        }
    };
    return error;
}

function assertCertTime(now, cert) {
    const validFrom = new Date(cert.validFrom);
    const validTo = new Date(cert.validTo);
    if (now < validFrom || now > validTo) {
        throw formatCertError(cert, 'The certificate has expired or is not yet valid', 'CERTIFICATE_VERIFICATION_ERROR');
    }
}

function assertCaCert(cert) {
    if (!cert.ca) {
        throw formatCertError(cert, 'Signing certificate is not a certificate authority', 'CERTIFICATE_VERIFICATION_ERROR');
    }
}

function findTrustedRoot(chainRoot, rootStore, now) {
    for (const rootCert of rootStore.rootCerts) {
        if (rootCert.fingerprint512 === chainRoot.cert.fingerprint512) {
            assertCaCert(rootCert);
            return true;
        }

        if (chainRoot.cert.checkIssued(rootCert)) {
            assertCertTime(now, rootCert);
            assertCaCert(rootCert);
            return true;
        }
    }
    return false;
}

function assertBimiExtKeyUsage(cert) {
    const keyUsage = cert.keyUsage || [];
    if (!keyUsage.includes(BIMI_EXT_KEY_USAGE_OID)) {
        throw formatCertError(cert, 'Certificate is missing required Extended Key Usage identifier', 'BIMI_EXT_KEY_MISSING', {
            description: 'BIMI certificates must include the id-kp-BrandIndicatorforMessageIdentification Extended Key Usage OID'
        });
    }
}

function validatedChain(certs, rootStore, now) {
    if (!certs?.length) {
        return false;
    }

    now = now || new Date();

    assertCertTime(now, certs[0].cert);

    for (let i = 1; i < certs.length; i++) {
        assertCaCert(certs[i].cert);
        if (!certs[i - 1].cert.checkIssued(certs[i].cert)) {
            throw formatCertError(certs[i - 1].cert, 'Invalid certificate chain', 'INVALID_CHAIN');
        }
        assertCertTime(now, certs[i].cert);
    }

    const chainRoot = certs[certs.length - 1];
    if (!findTrustedRoot(chainRoot, rootStore, now)) {
        throw formatCertError(certs[0].cert, 'Self signed certificate in certificate chain', 'SELF_SIGNED_CERT_IN_CHAIN');
    }

    assertBimiExtKeyUsage(certs[0].cert);

    return certs;
}

module.exports = { validatedChain };
