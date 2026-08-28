'use strict';

const fs = require('fs');
const pem = fs.readFileSync(__dirname + '/../test/fixtures/paypal_vmc.pem');
const { vmc } = require('..');

vmc(pem).then(logo => console.log(logo));
