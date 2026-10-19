'use strict';

// This is NOT a fork of node-forge, and it does not claim to patch that package.
// Newman -> postman-runtime loads node-forge only for ASAP signing, which this
// framework deliberately forbids in governed collections and iteration assets.
// Removing the upstream package also removes its vulnerable RSA verifier from
// the installed dependency graph. Fail closed if ASAP is nevertheless invoked.
function unsupportedAsap() {
  const error = new Error('ASAP authentication is unsupported by this framework; cryptographic node-forge operations are disabled');
  error.code = 'ERR_ASAP_AUTH_DISABLED';
  throw error;
}
module.exports = Object.freeze({
  util: Object.freeze({ decode64: unsupportedAsap }),
  asn1: Object.freeze({ fromDer: unsupportedAsap }),
  pki: Object.freeze({
    privateKeyFromAsn1: unsupportedAsap,
    privateKeyToPem: unsupportedAsap,
    privateKeyFromPem: unsupportedAsap,
    privateKeyToAsn1: unsupportedAsap,
    wrapRsaPrivateKey: unsupportedAsap,
    privateKeyInfoToPem: unsupportedAsap,
  }),
});
