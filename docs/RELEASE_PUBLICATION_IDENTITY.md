# Release publication identity boundary

Totem's deterministic release handoff ends with `totem.release-candidate/v1`, which binds the verified source commit/tree to the exact integrity metadata and compressed public archive bytes. Publication must not later attach those bytes to an unrelated or moving source ref.

`scripts/release-publication.mjs` provides a credential-free, non-publishing gate for that boundary. It accepts only a local Git tag name (or its canonical `refs/tags/...` form), peels lightweight or annotated tags to a commit, and verifies that the resolved commit and its tree exactly match `source.revision` and `source.tree` in the release candidate document.

## Rehearsal

After generating and verifying the release candidate, create a local rehearsal tag at the candidate source commit and run the validator:

```sh
git tag totem-publication-rehearsal HEAD
node scripts/release-publication.mjs --ref totem-publication-rehearsal
git tag -d totem-publication-rehearsal
```

The command reads only local Git objects and `dist/release/totem-public.candidate.json`; it does not fetch, push, create a GitHub Release, choose a license, or otherwise publish anything. Release Integrity CI performs the same local-tag rehearsal after binding the candidate.

An eventual publication workflow should fetch the intended tag ref explicitly, verify the candidate/artifact set, then run this gate immediately before publication. The tag name and returned `totem.release-publication/v1` proof can be retained with the publication evidence.

## Fail-closed rules

Publication validation fails when:

- the supplied ref is a branch or remote-tracking ref rather than a release tag;
- the tag is missing or cannot peel to a commit;
- the tag resolves to a commit other than the candidate's exact `source.revision`;
- the candidate's recorded source tree differs from the tree of that commit;
- the candidate source revision/tree are not full Git object IDs or the candidate document itself is invalid.

Both lightweight and annotated tags are supported. For annotated tags, the proof records the tag object's object ID separately from the peeled source commit so the distinction remains visible.

## Trust boundary

This check proves source/tag identity only. It does not publish a release, authorize a license, weaken the public/private Portal boundary, replace T953 pinned cross-repository inputs, or bypass the T909 -> T910 -> T912 measured physical chain. A tag can still be administratively moved after validation, so the eventual publication process must validate the exact fetched tag immediately before publication and retain the resulting proof together with the candidate metadata.
