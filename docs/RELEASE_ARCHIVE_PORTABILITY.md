# Release archive portability

Totem's public release bundle is a deterministic source/deployment tree. T940 adds a second boundary for the transport archive used on Unix/Pi deployment paths: paths, entry types, and executable permissions are checked before an archive is trusted.

## Commands

Build the canonical bundle first:

```bash
pnpm release:bundle:build
```

On Linux/macOS with a compatible `tar` implementation:

```bash
pnpm release:archive:create
pnpm release:archive:verify
pnpm release:archive:smoke
```

`release:archive:create` writes `dist/release/totem-public.tar.gz` in deterministic ustar form with sorted names, epoch mtimes, and numeric owner/group zero. It preserves the file modes already normalized by `release-bundle.mjs`.

`release:archive:verify` parses the archive itself and fails closed if it contains:

- absolute paths, drive-qualified paths, or `..` traversal;
- symlinks, hard links, devices, FIFOs, or other special entries;
- duplicate or unexpected regular files;
- group/world-writable directories;
- a missing required file;
- executable-bit drift relative to the release manifest, including a required executable losing `+x` or a non-executable file gaining it.

`release:archive:smoke` then extracts the exact archive into a temporary directory and verifies that every shipped regular file retained the expected Unix mode after extraction.

## Contract

The source of truth is `release-manifest.json` inside the T926 bundle. Every manifest file marked Git mode `100755` must be archived and extracted as `0755`; every `100644` file and the generated release manifest must be `0644`. No other regular file is allowed in the archive. Directories may be present only as normal directories and may not be group/world writable.

The archive validator intentionally accepts only ordinary ustar regular files/directories. This keeps the deployable artifact free from link and special-file semantics that could escape or mutate an extraction target.

## Platform boundary

Archive creation and extraction-mode smoke tests are Unix-specific because Windows does not provide the same executable-bit semantics. The parser, path/type/mode contract, and regression tests remain ordinary Node code and run as part of the repository test suite on all supported source-checkout CI platforms. Hosted release-integrity CI performs the real create/extract check on Ubuntu.

This guarantee is separate from T944 bundle-tree reproducibility: T944 checks that independent clean worktrees produce identical bundle content identity, while this archive gate checks transport-path safety and Unix mode preservation after that bundle exists.

## Remediation

If verification reports mode drift, fix the tracked Git executable bit (`git update-index --chmod=+x` or `--chmod=-x`) rather than patching the generated archive. For path/type failures, remove the unsafe entry from the packaging path and rebuild from a clean release bundle. Do not disable the validator to accept symlinks or special files.
