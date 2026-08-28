/* eslint no-unused-expressions:0 */
'use strict';

const fs = require('fs');
const chai = require('chai');
const expect = chai.expect;
const Path = require('path');

const { getCerts } = require('../lib/tools');
const { certInfo } = require('../lib/cert-info');

chai.config.includeStack = true;

const fixtures = {
    cnn: getCerts(fs.readFileSync(Path.join(__dirname, 'fixtures', 'cnn.pem')))
};

describe('CertInfo Tests', () => {
    it('Should return all expected fields', () => {
        const info = certInfo(fixtures.cnn[0].cert);

        expect(info).to.exist;
        expect(info).to.have.property('subject');
        expect(info).to.have.property('subjectAltName');
        expect(info).to.have.property('fingerprint');
        expect(info).to.have.property('serialNumber');
        expect(info).to.have.property('validFrom');
        expect(info).to.have.property('validTo');
        expect(info).to.have.property('issuer');
    });

    it('Should parse subject correctly', () => {
        const info = certInfo(fixtures.cnn[0].cert);

        expect(info.subject).to.be.an('object');
        expect(info.subject.commonName).to.equal('Cable News Network, Inc.');
        expect(info.subject.organizationName).to.equal('Cable News Network, Inc.');
        expect(info.subject.trademarkRegistration).to.equal('5817930');
        expect(info.subject.countryName).to.equal('US');
    });

    it('Should parse subjectAltName correctly', () => {
        const info = certInfo(fixtures.cnn[0].cert);

        expect(info.subjectAltName).to.be.an('array');
        expect(info.subjectAltName).to.deep.equal(['cnn.com']);
    });

    it('Should have correct fingerprint', () => {
        const info = certInfo(fixtures.cnn[0].cert);

        expect(info.fingerprint).to.equal('17:B3:94:97:E6:6B:C8:6B:33:B8:0A:D2:F0:79:6B:08:A2:A6:84:BD');
    });

    it('Should have valid date strings', () => {
        const info = certInfo(fixtures.cnn[0].cert);

        expect(info.validFrom).to.be.a('string');
        expect(info.validTo).to.be.a('string');

        // Verify they are valid ISO date strings
        const validFromDate = new Date(info.validFrom);
        const validToDate = new Date(info.validTo);

        expect(validFromDate.toString()).to.not.equal('Invalid Date');
        expect(validToDate.toString()).to.not.equal('Invalid Date');
    });

    it('Should parse issuer correctly', () => {
        const info = certInfo(fixtures.cnn[0].cert);

        expect(info.issuer).to.be.an('object');
        expect(info.issuer.commonName).to.exist;
    });
});
