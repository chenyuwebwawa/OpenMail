/* eslint no-unused-expressions:0 */
'use strict';

const fs = require('fs');
const chai = require('chai');
const expect = chai.expect;
const Path = require('path');
const { X509Certificate } = require('crypto');

const { getCerts, parsePemBundle, getDateString, parseSubject } = require('../lib/tools');

chai.config.includeStack = true;

const fixtures = {
    cnn: fs.readFileSync(Path.join(__dirname, 'fixtures', 'cnn.pem')),
    redshift: fs.readFileSync(Path.join(__dirname, 'fixtures', 'redshift.pem')),
    digicert: fs.readFileSync(Path.join(__dirname, 'fixtures', 'digicert.pem')),
    entrust: fs.readFileSync(Path.join(__dirname, 'fixtures', 'entrust_vmc_specific.pem')),
    globalsignRoot: fs.readFileSync(Path.join(__dirname, 'fixtures', 'globalsign-root.pem'))
};

describe('Tools Tests', () => {
    describe('parsePemBundle Tests', () => {
        it('Should parse CNN bundle', async () => {
            let certs = parsePemBundle(fixtures.cnn);
            expect(certs.length).to.equal(3);
        });

        it('Should parse Redshift bundle', async () => {
            let certs = parsePemBundle(fixtures.redshift);
            expect(certs.length).to.equal(2);
        });

        it('Should parse DigiCert root', async () => {
            let certs = parsePemBundle(fixtures.digicert);
            expect(certs.length).to.equal(1);
        });

        it('Should parse Entrust root', async () => {
            let certs = parsePemBundle(fixtures.entrust);
            expect(certs.length).to.equal(1);
        });

        it('Should parse Globalsign root', async () => {
            let certs = parsePemBundle(fixtures.globalsignRoot);
            expect(certs.length).to.equal(1);
        });
    });

    describe('getCerts Tests', () => {
        it('Should parse CNN bundle', async () => {
            let certs = getCerts(fixtures.cnn);
            expect(certs.length).to.equal(3);
            for (let cert of certs) {
                expect(cert.cert instanceof X509Certificate).to.be.true;
            }
        });

        it('Should parse Redshift bundle', async () => {
            let certs = getCerts(fixtures.redshift);
            expect(certs.length).to.equal(2);
            for (let cert of certs) {
                expect(cert.cert instanceof X509Certificate).to.be.true;
            }
        });

        it('Should return false for null input', async () => {
            let certs = getCerts(null);
            expect(certs).to.equal(false);
        });

        it('Should return false for empty string', async () => {
            let certs = getCerts('');
            expect(certs).to.equal(false);
        });
    });

    describe('parsePemBundle Edge Cases', () => {
        it('Should return null for null input', async () => {
            let certs = parsePemBundle(null);
            expect(certs).to.be.null;
        });

        it('Should return null for empty string', async () => {
            let certs = parsePemBundle('');
            expect(certs).to.be.null;
        });

        it('Should return null for invalid PEM content', async () => {
            let certs = parsePemBundle('not a valid pem');
            expect(certs).to.be.null;
        });
    });

    describe('getDateString Tests', () => {
        it('Should convert Date object to ISO string', async () => {
            let date = new Date('2024-01-15T10:30:00.000Z');
            let result = getDateString(date);
            expect(result).to.equal('2024-01-15T10:30:00.000Z');
        });

        it('Should convert valid date string to ISO string', async () => {
            let result = getDateString('Jan 15, 2024 10:30:00 GMT');
            expect(result).to.be.a('string');
            // Verify it's a valid ISO date
            let parsed = new Date(result);
            expect(parsed.toString()).to.not.equal('Invalid Date');
        });

        it('Should return original string for invalid date string', async () => {
            let result = getDateString('not a date');
            expect(result).to.equal('not a date');
        });

        it('Should return null for null input', async () => {
            let result = getDateString(null);
            expect(result).to.be.null;
        });

        it('Should return null for undefined input', async () => {
            let result = getDateString(undefined);
            expect(result).to.be.null;
        });

        it('Should handle object with toISOString method', async () => {
            let obj = {
                toISOString: () => '2024-01-15T10:30:00.000Z'
            };
            let result = getDateString(obj);
            expect(result).to.equal('2024-01-15T10:30:00.000Z');
        });

        it('Should handle object with only toString method', async () => {
            let obj = {
                toString: () => 'custom date string'
            };
            let result = getDateString(obj);
            expect(result).to.equal('custom date string');
        });
    });

    describe('parseSubject Tests', () => {
        it('Should parse standard subject with CN, O, C', async () => {
            let subject = 'CN=example.com\nO=Example Inc\nC=US';
            let result = parseSubject(subject);

            expect(result).to.be.an('object');
            expect(result.commonName).to.equal('example.com');
            expect(result.organizationName).to.equal('Example Inc');
            expect(result.countryName).to.equal('US');
        });

        it('Should parse subject with VMC OIDs', async () => {
            let subject = 'CN=example.com\n1.3.6.1.4.1.53087.1.4=12345\n1.3.6.1.4.1.53087.1.6=EXAMPLE';
            let result = parseSubject(subject);

            expect(result).to.be.an('object');
            expect(result.commonName).to.equal('example.com');
            expect(result.trademarkRegistration).to.equal('12345');
            expect(result.wordMark).to.equal('EXAMPLE');
        });

        it('Should return empty object for null input', async () => {
            let result = parseSubject(null);
            expect(result).to.be.an('object');
            expect(Object.keys(result).length).to.equal(0);
        });

        it('Should return empty object for empty string', async () => {
            let result = parseSubject('');
            expect(result).to.be.an('object');
            expect(Object.keys(result).length).to.equal(0);
        });

        it('Should handle escaped commas in values', async () => {
            let subject = 'CN=example.com\nO=Company\\, Inc';
            let result = parseSubject(subject);

            expect(result.organizationName).to.equal('Company, Inc');
        });

        it('Should handle quoted values', async () => {
            let subject = 'CN=example.com\nO="Company Name"';
            let result = parseSubject(subject);

            expect(result.organizationName).to.equal('Company Name');
        });

        it('Should handle all standard OIDs', async () => {
            let subject = 'CN=example.com\nO=Org\nOU=Unit\nL=City\nST=State\nC=US';
            let result = parseSubject(subject);

            expect(result.commonName).to.equal('example.com');
            expect(result.organizationName).to.equal('Org');
            expect(result.organizationalUnitName).to.equal('Unit');
            expect(result.localityName).to.equal('City');
            expect(result.stateOrProvinceName).to.equal('State');
            expect(result.countryName).to.equal('US');
        });
    });
});
