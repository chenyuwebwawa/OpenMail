/* eslint no-unused-expressions:0 */
'use strict';

const fs = require('fs');
const chai = require('chai');
const expect = chai.expect;
const Path = require('path');

const { vmc, RootStore } = require('../lib/vmc');

chai.config.includeStack = true;

// Use fixed time for validation checks
const CUR_DATE_FIXED_2 = '2024-11-05T06:50:13.343Z';

const fixtures = {
    paypal: fs.readFileSync(Path.join(__dirname, 'fixtures', 'paypal_vmc.pem'))
};

describe('VMC Function Tests', () => {
    describe('Error Cases', () => {
        it('Should throw INVALID_CERT_BUNDLE for empty certificate bundle', async () => {
            try {
                await vmc('');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err).to.exist;
                expect(err.code).to.equal('INVALID_CERT_BUNDLE');
            }
        });

        it('Should throw INVALID_CERT_BUNDLE for null certificate bundle', async () => {
            try {
                await vmc(null);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err).to.exist;
                expect(err.code).to.equal('INVALID_CERT_BUNDLE');
            }
        });

        it('Should throw INVALID_CERT_BUNDLE for undefined certificate bundle', async () => {
            try {
                await vmc(undefined);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err).to.exist;
                expect(err.code).to.equal('INVALID_CERT_BUNDLE');
            }
        });
    });

    describe('Custom RootStore Option', () => {
        it('Should accept custom rootStore option', async () => {
            const customRootStore = RootStore.create();
            const logo = await vmc(fixtures.paypal, {
                rootStore: customRootStore,
                now: new Date(CUR_DATE_FIXED_2)
            });

            expect(logo).to.exist;
            expect(logo.type).to.equal('VMC');
            expect(logo.certificate.subjectAltName).to.deep.equal(['paypal.com']);
        });
    });
});
