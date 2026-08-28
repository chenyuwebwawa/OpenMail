'use strict';

const { RootStore } = require('./root-store');
const { getCerts } = require('./tools');
const { validatedChain } = require('./validated-chain');
const { parseVMC } = require('./parse-vmc');
const { certInfo } = require('./cert-info');

const defaultRootStore = RootStore.create();

// Mark types that indicate a CMC (Common Mark Certificate) rather than VMC (Verified Mark Certificate)
// CMC certificates are for marks without full trademark registration
const CMC_MARK_TYPES = new Set(['Prior Use Mark', 'Modified Registered Mark']);

function createError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function determineLogoType(markType) {
    return CMC_MARK_TYPES.has(markType) ? 'CMC' : 'VMC';
}

async function vmc(pem, options = {}) {
    const rootStore = options.rootStore || defaultRootStore;
    const now = options.now;

    const vmcCerts = getCerts(pem);
    if (!vmcCerts) {
        throw createError('Empty or missing certificate bundle', 'INVALID_CERT_BUNDLE');
    }

    const chain = validatedChain(vmcCerts, rootStore, now);
    if (!chain) {
        throw createError('Empty or missing certificate chain', 'INVALID_CHAIN');
    }

    const logo = await parseVMC(chain[0].cert.raw);
    const certificate = certInfo(chain[0].cert);

    logo.type = determineLogoType(certificate?.subject?.markType);
    logo.certificate = certificate;
    logo.hashValue = logo.hashValue?.toString('hex');
    logo.logoFile = logo.logoFile?.toString('base64');

    return logo;
}

module.exports = { vmc, RootStore };
