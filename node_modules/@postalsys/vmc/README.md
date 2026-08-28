# VMC

A Node.js library for parsing and validating VMC (Verified Mark Certificate) and CMC (Common Mark Certificate) logo files used in BIMI (Brand Indicators for Message Identification) email authentication.

## Installation

```bash
npm install @postalsys/vmc
```

## Usage

```javascript
const { vmc, RootStore } = require('@postalsys/vmc');
const fs = require('fs');

// Load a PEM certificate bundle (leaf cert + intermediates)
const pemBundle = fs.readFileSync('certificate.pem');

// Parse and validate the VMC
const logo = await vmc(pemBundle);

console.log(logo.type); // 'VMC' or 'CMC'
console.log(logo.mediaType); // 'image/svg+xml'
console.log(logo.validHash); // true if logo hash matches
console.log(logo.logoFile); // Base64-encoded SVG logo
console.log(logo.certificate); // Certificate details
```

### Using a Custom Root Store

```javascript
const { vmc, RootStore } = require('@postalsys/vmc');

// Create a custom root store
const rootStore = RootStore.create();

// Optionally add additional trusted root certificates
rootStore.addCert(customRootPem);

const logo = await vmc(pemBundle, { rootStore });
```

### Validating at a Specific Time

```javascript
// Useful for testing with certificates that may have expired
const logo = await vmc(pemBundle, { now: new Date('2024-01-15') });
```

## API

### vmc(pem, [options])

Parses and validates a VMC/CMC certificate bundle.

**Parameters:**

- `pem` (Buffer|string) - PEM-encoded certificate bundle containing the leaf certificate and any intermediate certificates
- `options` (object, optional)
    - `rootStore` (RootStore) - Custom root store for certificate validation. Defaults to built-in VMC root certificates.
    - `now` (Date) - Date to use for certificate validity checks. Defaults to current time.

**Returns:** Promise resolving to an object:

```javascript
{
  type: 'VMC',              // 'VMC' (Verified Mark) or 'CMC' (Common Mark)
  mediaType: 'image/svg+xml',
  hashAlgo: 'sha256',       // Hash algorithm used
  hashValue: '07001de5...',  // Hex-encoded hash of the logo
  validHash: true,          // Whether the logo hash is valid
  logoFile: 'PHN2ZyB4...',  // Base64-encoded logo file (SVG)
  certificate: {
    subject: {
      commonName: 'Example Corp',
      organizationName: 'Example Corp',
      countryName: 'US',
      trademarkRegistration: '1234567',
      // ... other fields
    },
    subjectAltName: ['example.com'],
    fingerprint: '17:B3:94:...',
    serialNumber: '0A1B2C...',
    validFrom: '2024-01-01T00:00:00.000Z',
    validTo: '2025-01-01T00:00:00.000Z',
    issuer: { /* issuer details */ }
  }
}
```

### RootStore

Class for managing trusted root certificates.

#### RootStore.create([config])

Creates a new RootStore instance preloaded with built-in VMC root certificates (DigiCert, Entrust, GlobalSign, SSL.com).

#### rootStore.addCert(pem)

Adds a trusted root certificate to the store.

- `pem` (string) - PEM-encoded certificate
- Returns `true` if added, `false` if duplicate

## Error Codes

All errors include a `code` property for programmatic handling:

| Code                             | Description                                     |
| -------------------------------- | ----------------------------------------------- |
| `INVALID_CERT_BUNDLE`            | Empty or invalid PEM certificate bundle         |
| `INVALID_CHAIN`                  | Certificate chain validation failed             |
| `INVALID_LOGOTYPE_EXT`           | Certificate missing required logotype extension |
| `CERTIFICATE_VERIFICATION_ERROR` | Certificate expired or not yet valid            |
| `SELF_SIGNED_CERT_IN_CHAIN`      | No trusted root found for the certificate chain |
| `BIMI_EXT_KEY_MISSING`           | Certificate missing BIMI Extended Key Usage OID |

```javascript
try {
    const logo = await vmc(pemBundle);
} catch (err) {
    if (err.code === 'CERTIFICATE_VERIFICATION_ERROR') {
        console.log('Certificate has expired');
    }
}
```

## VMC vs CMC

- **VMC (Verified Mark Certificate)** - Requires a registered trademark
- **CMC (Common Mark Certificate)** - For marks without trademark registration (Prior Use Mark, Modified Registered Mark)

The `type` field in the response indicates which certificate type was used.

## License

MIT
