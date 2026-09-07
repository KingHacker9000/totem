# Release archive portability

Totem's public release bundle is a deterministic source/deployment tree. T940 adds a second boundary for the transport archive used on Unix/Pi deployment paths: paths, entry types, and executable permissions are checked before an archive is trusted. T945 extends both bundle and archive verification with a filesystem-portable path contract so a Linux-valid release cannot become ambiguous or unextractable on common case-insensitive/Windows filesystems. T947 additionally makes the final gzip layer deterministic and proves repeated compression produces identical shipped bytes.

## Commands

Build the canonical bundle first:

```bash
pnpm release:bundle:build
```

The supported bundle build/verify commands automatically run the portable-path validator. It can also be invoked explicitly:

```bash
pnpm release:paths:bundle
```

On Linux/macOS with compatible `tar` and `gzip` implementations:

```bash
pnpm release:archive:create
pnpm release:archive:verify
pnpm release:archive:smoke
pnpm release:archive:reproducibility
```

These supported archive commands automatically validate portable archive paths as well. The standalone check is:

```bash
pnpm release:paths:archive
```

`release:archive:create` writes `dist/release/totem-public.tar.gz` in deterministic ustar form with sorted names, epoch mtimes, and numeric owner/group zero. It first creates the canonical uncompressed tar payload and then compresses it with `gzip -n`, which suppresses source filename and timestamp metadata. It preserves the file modes already normalized by `release-bundle.mjs`.

`release:archive:verify` parses the gzip header and tar stream itself and fails closed if it contains:

- a non-gzip artifact, unsupported compression method, non-zero gzip timestamp, or optional gzip header fields such as a source filename;
- absolute paths, drive-qualified paths, or `..` traversal;
- symlinks, hard links, devices, FIFOs, or other special entries;
- duplicate or unexpected regular files;
- group/world-writable directories;
- a missing required file;
- executable-bit drift relative to the release manifest, including a required executable losing `+x` or a non-executable file gaining it;
- invalid ustar header checksums, truncated headers/payloads/padding, malformed or incomplete two-block end markers, non-zero entry padding, or non-zero data after the logical archive terminator.

The portable-path layer additionally fails closed when bundle or archive paths contain:

- case-fold collisions such as `Docs/README.md` and `docs/readme.md`;
- Windows reserved device basenames such as `CON`, `AUX`, `NUL`, `COM1`-`COM9`, or `LPT1`-`LPT9`, including names with extensions;
- path components ending in a dot or space;
- Windows-invalid path characters/control characters;
- backslashes or unsafe/empty relative components.

Case-fold keys use NFC normalization plus lowercase conversion. This contract is intentionally stricter than Linux so one published artifact has deterministic names across the supported consumer filesystems.

`release:archive:smoke` extracts the exact archive into a temporary directory and verifies that every shipped regular file retained the expected Unix mode after extraction.

`release:archive:reproducibility` independently creates the compressed archive twice from the same verified bundle while perturbing timezone/locale-related environment values. The command fails unless the final `.tar.gz` byte streams are exactly equal. Hosted Release Integrity CI runs this proof on Ubuntu before release-candidate identity is generated.

## Contract

The source of truth is `release-manifest.json` inside the T926 bundle. Every manifest file marked Git mode `100755` must be archived and extracted as `0755`; every `100644` file and the generated release manifest must be `0644`. No other regular file is allowed in the archive. Directories may be present only as normal directories and may not be group/world writable.

The same portable-path rules are applied to the bundle manifest and the parsed archive entry set through `release-portable-path-check.mjs`, preventing one boundary from accepting names that the other rejects.

The gzip header is part of the release contract: compression method must be DEFLATE, flags must be zero, and MTIME must be zero. That excludes filename/comment/extra-field metadata and wall-clock timestamps from the shipped identity. The tar validator intentionally accepts only structurally complete ordinary ustar regular files/directories. Every non-zero header checksum is recomputed with the checksum field treated as spaces, payload/padding boundaries must fit inside the stream, padding must be zero-filled, and the archive must end with the required two zero blocks followed only by optional zero padding.

## Platform boundary

Archive creation, byte-reproducibility, and extraction-mode smoke tests are Unix-specific because Windows does not provide the same executable-bit semantics or the required `tar`/`gzip` command contract. The parser, gzip-header contract, path/type/mode contract, portable-path contract, and regression tests remain ordinary Node code and run as part of the repository test suite on all supported source-checkout CI platforms. Hosted release-integrity CI performs the real create/reproduce/extract check on Ubuntu.

This guarantee is separate from T944 bundle-tree reproducibility: T944 checks that independent clean worktrees produce identical bundle content identity, while this archive gate checks transport-path safety, cross-filesystem naming safety, Unix mode preservation, tar stream structural integrity, and byte-for-byte reproducibility of the final compressed artifact after that bundle exists.

## Remediation

If verification reports gzip metadata drift, discard the archive and rebuild it with the supported command rather than recompressing manually. If verification reports mode drift, fix the tracked Git executable bit (`git update-index --chmod=+x` or `--chmod=-x`) rather than patching the generated archive. If it reports a path-portability collision or invalid component, rename the tracked source path so the public release has one unambiguous portable spelling. For checksum, truncation, end-marker, padding, path, or type failures, discard the archive and rebuild it from a clean verified release bundle. Do not disable the validator to accept corrupted streams, appended data, symlinks, special files, filesystem-dependent names, or nondeterministic compression metadata.
