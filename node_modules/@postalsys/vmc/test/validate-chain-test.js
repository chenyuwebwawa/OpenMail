/* eslint no-unused-expressions:0 */
'use strict';

const fs = require('fs');
const chai = require('chai');
const expect = chai.expect;
const Path = require('path');

const { getCerts } = require('../lib/tools');
const { RootStore } = require('../lib/root-store');
const { validatedChain } = require('../lib/validated-chain');

chai.config.includeStack = true;

// Use fixed time for validation checks
const CUR_DATE_FIXED = '2022-07-09T08:30:14.715Z';

const fixtures = {
    cnn: fs.readFileSync(Path.join(__dirname, 'fixtures', 'cnn.pem')),
    postal: fs.readFileSync(Path.join(__dirname, 'fixtures', 'postal_vmc.pem')),
    catchall: fs.readFileSync(Path.join(__dirname, 'fixtures', 'catchall.delivery.pem')),
    globalsign: fs.readFileSync(Path.join(__dirname, 'fixtures', 'globalsign-vmc.pem'))
};

describe('Chain Validation Tests', () => {
    it('Should validate chain', async () => {
        const rootStore = RootStore.create();
        const certs = getCerts(fixtures.cnn);

        // use fixed date so that the tests would not break in the future
        const chain = validatedChain(certs, rootStore, new Date(CUR_DATE_FIXED));
        expect(chain).to.exist;
        expect(chain.length).to.equal(3);
    });

    it('Should validate chain  (globalsign)', async () => {
        const rootStore = RootStore.create();
        const certs = getCerts(fixtures.globalsign);

        // use fixed date so that the tests would not break in the future
        const chain = validatedChain(certs, rootStore, new Date('2025-04-21T11:15:01.885Z'));
        expect(chain).to.exist;
        expect(chain.length).to.equal(3);
    });

    it('Should fail chain validation', async () => {
        const rootStore = RootStore.create();
        const certs = getCerts(fixtures.cnn);

        try {
            const chain = validatedChain(certs, rootStore, new Date('1982-07-09T08:30:14.715Z'));
            expect(chain).to.not.exist;
        } catch (err) {
            expect(err).to.exist;
            expect(err.code).to.equal('CERTIFICATE_VERIFICATION_ERROR');
        }
    });

    it('Should fail invalid chain', async () => {
        const rootStore = RootStore.create();
        const certs = getCerts(fixtures.cnn);
        const psCerts = getCerts(fixtures.postal);
        certs[0] = psCerts[0];

        try {
            const chain = validatedChain(certs, rootStore, new Date(CUR_DATE_FIXED));
            expect(chain).to.not.exist;
        } catch (err) {
            expect(err).to.exist;
            expect(err.code).to.equal('INVALID_CHAIN');
        }
    });

    it('Should fail non-vmc validation', async () => {
        const rootStore = RootStore.create();
        const certs = getCerts(fixtures.catchall);

        try {
            const chain = validatedChain(certs, rootStore, new Date(CUR_DATE_FIXED));
            expect(chain).to.not.exist;
        } catch (err) {
            expect(err).to.exist;
            expect(err.code).to.equal('SELF_SIGNED_CERT_IN_CHAIN');
        }
    });

    it('Should fail non-vmc cert with custom root cert', async () => {
        const rootStore = RootStore.create();
        const certs = getCerts(fixtures.catchall);

        rootStore.addCert(certs[certs.length - 1].pem);

        try {
            const chain = validatedChain(certs, rootStore, new Date(CUR_DATE_FIXED));
            expect(chain).to.not.exist;
        } catch (err) {
            expect(err).to.exist;
            expect(err.code).to.equal('BIMI_EXT_KEY_MISSING');
        }
    });
});
