'use strict';

var assert = require('assert');
var n = require('./');

// http://backreference.org/2013/03/01/ipv6-address-normalization/
assert(n('2001:db8:0:0:0:0:cafe:1111') === '2001:db8::cafe:1111');
assert(n('2001:db8::a:1:2:3:4') === '2001:db8:0:a:1:2:3:4');
assert(n('2001:0DB8:AAAA:0000:0000:0000:0000:000C') === '2001:db8:aaaa::c');
assert(n('2001:db8::1:0:0:0:4') === '2001:db8:0:1::4');
