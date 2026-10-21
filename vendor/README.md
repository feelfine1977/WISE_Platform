# Packed libraries

The application uses two libraries that have no published release yet. So that a checkout of this repository is enough to install and run the application, the exact builds are kept here.

| Library | Version | File | Built from | Licence |
| --- | --- | --- | --- | --- |
| Process map (`wise-flow`) | 0.3.5 | `wise-flow-0.3.5.tgz` | `feelfine1977/wise-flow` at `471cf75` | PolyForm Noncommercial 1.0.0 |
| Method (`wise-pm`) | 0.2.0 | `wise_pm-0.2.0-py3-none-any.whl` | `feelfine1977/wise-pm` at `6883db5` | MIT |

Both are unreleased states. The process map library is packed from a commit of its branch `flow-readable-opening`, which follows its branch `flow-look` and adds the readable opening of a large map (#65): a smallest zoom derived from the cards' texts, the part of the map in view, an element brought into view on request, and names shortened alike told apart. That state still carries the version number 0.3.5, as the builds kept here before it did, so the version alone does not identify the build; the commit and the SHA-256 do. The library's own checks have not been confirmed to pass on GitHub at that commit, so the map in this application is not a qualified result of a released library. `manifest.json` records the SHA-256 of each file; a test compares the files with it.

The files are replaced by published releases as soon as those exist. Nothing in this folder is edited by hand.
