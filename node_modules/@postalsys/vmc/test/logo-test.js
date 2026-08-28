/* eslint no-unused-expressions:0 */
'use strict';

const fs = require('fs');
const chai = require('chai');
const expect = chai.expect;
const Path = require('path');

const { vmc } = require('../lib/vmc');

chai.config.includeStack = true;

// Use fixed time for validation checks
const CUR_DATE_FIXED = '2022-07-09T08:30:14.715Z';
const CUR_DATE_FIXED_2 = '2024-11-05T06:50:13.343Z';

const fixtures = {
    cnn: fs.readFileSync(Path.join(__dirname, 'fixtures', 'cnn.pem')),
    postal: fs.readFileSync(Path.join(__dirname, 'fixtures', 'postal_vmc.pem')),
    catchall: fs.readFileSync(Path.join(__dirname, 'fixtures', 'catchall.delivery.pem')),
    paypal: fs.readFileSync(Path.join(__dirname, 'fixtures', 'paypal_vmc.pem')),
    xometry: fs.readFileSync(Path.join(__dirname, 'fixtures', 'xometry_cmc.pem'))
};

describe('Logo Validation Tests', () => {
    it('Should validate logo', async () => {
        let logo = await vmc(fixtures.cnn, { now: new Date(CUR_DATE_FIXED) });
        expect(logo).to.exist;
        expect(logo.hashValue).to.equal('ea8c81da633c66a16262134a78576cdf067638e9');
        expect(logo.certificate.subjectAltName).to.deep.equal(['cnn.com']);

        expect(logo.certificate.subject.trademarkRegistration).to.equal('5817930');
        expect(logo.certificate.fingerprint).to.equal('17:B3:94:97:E6:6B:C8:6B:33:B8:0A:D2:F0:79:6B:08:A2:A6:84:BD');
    });

    it('Should detect VMC logo', async () => {
        let logo = await vmc(fixtures.paypal, { now: new Date(CUR_DATE_FIXED_2) });

        expect(logo).to.exist;
        expect(logo.hashValue).to.equal('b4be74ff04b1d9e5770ed822c335d3bfac65970e');
        expect(logo.certificate.subjectAltName).to.deep.equal(['paypal.com']);

        expect(logo.type).to.equal('VMC');
        expect(logo.certificate.subject.trademarkRegistration).to.equal('6275156');

        expect(logo.certificate.fingerprint).to.equal('CA:0A:34:BD:B8:20:49:A6:2D:B6:80:56:39:1B:07:7E:2B:B5:7B:8E');
    });

    it('Should detect CMC logo', async () => {
        let logo = await vmc(fixtures.xometry, { now: new Date(CUR_DATE_FIXED_2) });

        expect(logo).to.exist;
        expect(logo.hashValue).to.equal('402efe1592dede57724765d9556b32ee7ca043c0');
        expect(logo.certificate.subjectAltName).to.deep.equal(['xometry.com']);

        expect(logo.type).to.equal('CMC');
        expect(logo.certificate.subject.trademarkRegistration).to.not.exist;

        expect(logo.certificate.fingerprint).to.equal('2B:8C:D4:79:2F:CA:C4:5A:A2:CC:7C:01:F3:DD:9A:60:5A:DE:43:A7');
    });
});
