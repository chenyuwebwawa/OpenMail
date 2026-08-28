/* eslint no-unused-expressions:0 */
'use strict';

const fs = require('fs');
const chai = require('chai');
const expect = chai.expect;
const Path = require('path');

const { RootStore } = require('../lib/root-store');

chai.config.includeStack = true;

const fixtures = {
    postal: fs.readFileSync(Path.join(__dirname, 'fixtures', 'postal_vmc.pem'))
};

describe('Root Store Tests', () => {
    it('Should create Root Store', async () => {
        let rootStore = RootStore.create();
        expect(rootStore).to.exist;
    });

    it('Should add extra cert to Root Store', async () => {
        let rootStore = RootStore.create();
        expect(rootStore).to.exist;
        expect(rootStore.addCert(fixtures.postal)).to.equal(true);
        expect(rootStore.addCert(fixtures.postal)).to.equal(false);
    });
});
