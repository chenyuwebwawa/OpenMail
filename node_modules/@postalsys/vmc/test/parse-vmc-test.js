/* eslint no-unused-expressions:0 */
'use strict';

const fs = require('fs');
const chai = require('chai');
const expect = chai.expect;
const Path = require('path');
const crypto = require('crypto');

const { getCerts } = require('../lib/tools');
const { parseVMC } = require('../lib/parse-vmc');

chai.config.includeStack = true;

const fixtures = {
    cnn: getCerts(fs.readFileSync(Path.join(__dirname, 'fixtures', 'cnn.pem'))),
    redshift: getCerts(fs.readFileSync(Path.join(__dirname, 'fixtures', 'redshift.pem'))),
    digicert: getCerts(fs.readFileSync(Path.join(__dirname, 'fixtures', 'digicert.pem')))
};

describe('VMC Parser Tests', () => {
    it('Should parse Redshift VMC', async () => {
        let parsed = await parseVMC(fixtures.redshift[0].cert.raw);
        expect(parsed).to.exist;

        expect(parsed.hashAlgo).to.equal('sha256');
        expect(parsed.hashValue.toString('hex')).to.equal('07001de5838688fb340e2a92a8d1e23e5b28aea5fc195403bcfa02055b318a00');
        expect(parsed.validHash).to.be.true;

        let hash = crypto.createHash('sha256').update(parsed.logoFile).digest('hex');
        expect(hash).to.equal('07001de5838688fb340e2a92a8d1e23e5b28aea5fc195403bcfa02055b318a00');
    });

    it('Should parse CNN VMC', async () => {
        let parsed = await parseVMC(fixtures.cnn[0].cert.raw);
        expect(parsed).to.exist;

        expect(parsed.hashAlgo).to.equal('sha1');
        expect(parsed.hashValue.toString('hex')).to.equal('ea8c81da633c66a16262134a78576cdf067638e9');
        expect(parsed.validHash).to.be.true;

        let hash = crypto.createHash('sha1').update(parsed.logoFile).digest('hex');
        expect(hash).to.equal('ea8c81da633c66a16262134a78576cdf067638e9');
    });

    it('Should throw INVALID_LOGOTYPE_EXT for certificate without logotype extension', async () => {
        try {
            // digicert.pem is a root certificate without logotype extension
            await parseVMC(fixtures.digicert[0].cert.raw);
            expect.fail('Should have thrown an error');
        } catch (err) {
            expect(err).to.exist;
            expect(err.code).to.equal('INVALID_LOGOTYPE_EXT');
        }
    });
});
