# Prepared-v1 catalogue provenance

The public declared-prepared API's `catalogue_sha256` identifies the immutable
upstream historical29 catalogue defining prepared-v1:
`498d0464d11ede078bf75818d0b329ff946077ffbe93a4b6f5f4aaf27eeddaef`.
It is not the digest of a distribution copy. This distinction preserves existing
declaration content IDs, closed schema constants and stored native references.

The shipped catalogue is a separately verified adaptation. Its actual raw digest
is `54842010ffe89ea41a0e17ae7617e619a116d6ad7f0cb83bbb07df55faf87ffe`.
Policy `bpic19.catalogue.omit_unused_private_default.v1` removes only the unused
JSON pointer `/preparation/path_default`, which held a machine-local source
default. The adaptation changes no criterion, selector, measurement policy,
threshold, layer/view weight or flow scope. Source data is still selected through
the authorized workspace; the historical default is never executed.

This is a provenance clarification and an explicitly identified distribution
adaptation, not a claim that the original and distributed bytes have the same
hash. `historical_catalogue().source_sha256` always hashes the actual bytes read.
Both raw historical binding and prepared-input validation require the exact
distribution digest, and refuse any changed bytes. They do not admit arbitrary
catalogues merely because their bindings appear equivalent. Native norm metadata
records the actual digest, upstream digest and named adaptation separately.

Method's semantic norm fingerprint excludes metadata and descriptions. The
unchanged analytical definition can therefore retain its semantic fingerprint.
Future native outputs include the new provenance metadata and acquire their own
content hashes. Reading or exporting an existing stored run retains its original
norm, output, definition and run bytes; it does not rescore or rewrite history.
The wheel's private-path audit and its source/data integrity checks remain release
gates. Local portable wheel checks do not qualify a Windows installer or release.
