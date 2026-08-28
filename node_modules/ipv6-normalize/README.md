ipv6-normalize
==============

```bash
$ npm i --save ipv6-normalize
```

Extract `bestPresentation` function from [URI.js/src/IPv6.js](https://github.com/medialize/URI.js) into independent module.

```javascript
'use strict';

var assert = require('assert');
var n = require('./');

assert(n('2001:db8:0:0:0:0:cafe:1111') === '2001:db8::cafe:1111');
assert(n('2001:db8::a:1:2:3:4') === '2001:db8:0:a:1:2:3:4');
assert(n('2001:0DB8:AAAA:0000:0000:0000:0000:000C') === '2001:db8:aaaa::c');
assert(n('2001:db8::1:0:0:0:4') === '2001:db8:0:1::4');
```

## License

The MIT License (MIT)

[http://poying.mit-license.org/](http://poying.mit-license.org/)
