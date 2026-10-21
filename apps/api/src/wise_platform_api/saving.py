"""Saving an investigation in its workspace, listing what is saved, and reopening it.

Saving checks the meaning of the question before anything is written: the
stored source still has the bytes of its id, the preparation is kept in the
workspace and gives the base identity, the steps replayed on the parent give
the selection identity, the comparison recomputed gives its comparison id,
and every bookmark names a population of this question, an incident of it and
rows of that incident. Then the content is published as the next revision
(see ``saved_store``). A score reference is refused while the application has
no scoring: nothing is invented for it.

Reopening reads the saved revision, refuses one saved by another analytics
version, and recomputes the question from the stored source bytes and the
saved recipe of the preparation. A preparation no longer kept in the
workspace is prepared again from the saved recipe and kept again when it
gives the same preparation id. Equal identities and counts mean restored: the
parent, the selection and the comparison's groups are then kept in the
selection registry, so that maps and complete histories can be asked for at
once. A missing or changed source or preparation, or any differing identity,
is a typed refusal that names what is missing or what differs; nothing is
answered as if it were the saved state.

The analytics package computes every membership, count and identity; this
module compares what it computes with what was saved.
"""

from __future__ import annotations

import logging
import hashlib
import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError
from wise_platform_analytics.csv_inspection import SourceChanged
from wise_platform_analytics.mapping import ImportRefusal as PackageRefusal
from wise_platform_analytics.preparation import PreparationResult, PreparedData, prepare, content_identity, PARSER_VERSION
from wise_platform_analytics.selection import SelectionError, SelectionResult, select_cases
from wise_platform_analytics.version import IMPLEMENTATION_VERSION

from . import __version__
from .boundary import SCHEMA_VERSION
from .bpic19_pipeline import replay_pipeline
from .bpic19_prepared_runs import retained_prepared_manifest
from .comparisons import compared, keep_comparison
from .generated.saving import (
    ListSavedAnswer,
    ListSavedRequest,
    PresentationRecovery,
    ReopenInvestigationAnswer,
    ReopenInvestigationRequest,
    RefreshInvestigationAnswer,
    RefreshInvestigationRequest,
    RecoverInvestigationMetadataRequest,
    RecoverInvestigationMetadataAnswer,
    SaveInvestigationAnswer,
    SaveInvestigationRequest1,
    SavingRefusal,
)
from .import_boundary import import_echo
from .imports import Imports
from .saved_store import Conflict, SavedInvestigations, StoredRevision
from .saving_boundary import (
    LIST_SAVED,
    REOPEN,
    REFRESH,
    RECOVER_METADATA,
    SAVE,
    STATUS,
    parse_saving_body,
    refusal_body,
    saving_refusal,
)
from .selections import package_predicate
from .workspace import Problem, StoredPreparation, Workspace, source_changed

logger = logging.getLogger(__name__)

_BINDING = ("source_id", "preparation_id", "representation_id", "case_dictionary_id", "implementation_version")
_IDENTITY_NAMES = {
    "source_id": "source",
    "preparation_id": "preparation",
    "representation_id": "representation",
    "case_dictionary_id": "case dictionary",
    "population_id": "population",
    "implementation_version": "implementation version",
}


@dataclass(frozen=True)
class SavingReply:
    """A contract message, as the JSON it is sent as, and its HTTP status."""

    status: int
    body: dict


@dataclass(frozen=True)
class Question:
    """A saved question recomputed from its source: the snapshot, the selection and the comparison."""

    prepared: PreparedData
    source: Mapping[str, object]
    preparation: StoredPreparation
    parent: SelectionResult
    selection: SelectionResult
    comparison: dict | None


class Saving:
    """The saving operations over the workspaces and preparations of the import operations."""

    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def save(self, body: bytes) -> SavingReply:
        return _answering(SAVE, parse_saving_body(body, SaveInvestigationRequest1, SAVE), self._save)

    def list_saved(self, body: bytes) -> SavingReply:
        return _answering(LIST_SAVED, parse_saving_body(body, ListSavedRequest, LIST_SAVED), self._list_saved)

    def reopen(self, body: bytes) -> SavingReply:
        return _answering(REOPEN, parse_saving_body(body, ReopenInvestigationRequest, REOPEN), self._reopen)

    def refresh(self, body: bytes) -> SavingReply:
        return _answering(REFRESH, parse_saving_body(body, RefreshInvestigationRequest, REFRESH), self._refresh)

    def recover_metadata(self, body: bytes) -> SavingReply:
        return _answering(RECOVER_METADATA, parse_saving_body(body, RecoverInvestigationMetadataRequest, RECOVER_METADATA), self._recover_metadata)

    # Use cases ----------------------------------------------------------------------------

    def _refresh(self, request: RefreshInvestigationRequest, given: dict) -> SavingReply:
        """A saved question on another reading, unsaved, with what changed: a refresh saves as a new revision, never over the old."""
        workspace = self._imports.opened_workspace(given["workspace_id"])
        if isinstance(workspace, Problem):
            return _problem(REFRESH, workspace, given)
        revision = SavedInvestigations(workspace).revision(given["saved_revision_id"])
        if isinstance(revision, Problem):
            return _problem(REFRESH, revision, given)
        if revision.content.get("bpic19_pipeline") is not None or revision.content.get("score_run_ref") is not None:
            return _refused(REFRESH, "unsupported_action", "A question with a scored run or a BPIC19 pipeline is refreshed by scoring the new reading; "
                            "reopen it and run it again instead.", given, "saved_revision_id")
        stored = workspace.preparation(given["preparation_id"])
        if isinstance(stored, Problem):
            return _problem(REFRESH, Problem(stored.code, stored.message, "preparation_id"), given)
        found = self._imports.prepared_snapshot(workspace, given["preparation_id"], "preparation_id")
        if isinstance(found, Problem):
            return _problem(REFRESH, found, given)
        if isinstance(found, PackageRefusal):
            return _refused(REFRESH, "preparation_unavailable", "This reading cannot be prepared again from its stored source.", given, "preparation_id")
        prepared = found[0]
        content = revision.content
        recipe = content["selection_recipe"]
        saved_parent = recipe["parent_case_ids"]
        results = revision.results
        whole = isinstance(results.get("base"), Mapping) and len(saved_parent) == results["base"].get("case_count")
        # A parent that was every incident of its reading is every incident of the new one; a narrower parent keeps its incidents.
        parent_ids = None if whole else list(saved_parent)
        try:
            predicates = [package_predicate(item) for item in recipe["predicates"]]
            selection = select_cases(prepared, predicates, parent_ids)
            parent = select_cases(prepared, (), parent_ids)
        except SelectionError as error:
            return _refused(REFRESH, "selection_mismatch", f"The saved steps or parent do not apply to this reading: {error}", given, "preparation_id")
        registry = self._imports.selections
        registry.keep(workspace.workspace_id, parent)
        registry.keep(workspace.workspace_id, selection)
        before_descriptor, after_descriptor = revision.preparation, stored.descriptor

        def item(aspect: str, before: object, after: object, status: str | None = None) -> dict[str, object]:
            text = lambda value: None if value is None else json.dumps(value, sort_keys=True, ensure_ascii=False) if not isinstance(value, str) else value
            return {"aspect": aspect, "status": status or ("unchanged" if before == after else "changed"), "before": text(before), "after": text(after)}

        old_selection = results.get("selection") if isinstance(results.get("selection"), Mapping) else {}
        old_parent = results.get("parent") if isinstance(results.get("parent"), Mapping) else {}
        review = [
            item("source", content["base_identity"]["source_id"], prepared.identity_dict()["source_id"]),
            item("binding", before_descriptor.get("mapping"), after_descriptor.get("mapping")),
            item("clock", (before_descriptor.get("policies") or {}).get("time"), (after_descriptor.get("policies") or {}).get("time")),
            item("parent", f"{old_parent.get('case_count')} incidents", f"{parent.parent.case_count} incidents"),
            item("selection", f"{(old_selection.get('kept') or {}).get('case_count')} incidents kept", f"{selection.kept.case_count} incidents kept"),
        ]
        if content.get("comparison") is not None:
            review.append(item("comparison", "saved comparison", None, "to_review"))
        selected = selection.to_dict()
        return _answer(
            RefreshInvestigationAnswer,
            _envelope("refresh_investigation_answer", given)
            | {
                "revision": revision.revision(),
                "preparation_id": given["preparation_id"],
                "parent_case_ids": parent_ids,
                "restored_selection": {
                    "identity": selected["identity"], "parent_identity": parent.identity_dict(), "parent": selected["parent"],
                    "kept": selected["kept"], "removed": selected["removed"], "unevaluable": selected["unevaluable"],
                    "predicate_results": selected["predicate_results"],
                },
                "review": review,
            },
        )

    def _recover_metadata(self, request: RecoverInvestigationMetadataRequest, given: dict) -> SavingReply:
        """Read bounded saved notes/references without replay, selection restoration or writes.

        The content hash is checked by the revision store. Source bytes and analytical
        artifacts are intentionally not admitted here: any original history is fetched
        independently through the normal source-evidence route.
        """
        workspace = self._imports.opened_workspace(given["workspace_id"])
        if isinstance(workspace, Problem):
            return _problem(RECOVER_METADATA, workspace, given)
        revision = SavedInvestigations(workspace).revision(given["saved_revision_id"])
        if isinstance(revision, Problem):
            return _problem(RECOVER_METADATA, revision, given)
        content = revision.content
        page = given["page"]
        def paged(items, offset, limit):
            end = min(offset + limit, len(items))
            return {"offset": offset, "total": len(items), "items": items[offset:end],
                    "next_offset": end if end < len(items) else None}
        note = content["notes"]
        offset = page["notes_offset"]
        end = min(offset + 4000, len(note))
        # Python string offsets are Unicode code points; the client follows the
        # supplied next offset rather than guessing from UTF-16 string length.
        notes = {"offset": offset, "total": len(note), "text": note[offset:end],
                 "next_offset": end if end < len(note) else None}
        bookmarks = paged(content["bookmarks"], page["bookmarks_offset"], 20)
        bookmarks["items"] = [{**bookmark, "label": bookmark["label"][:256],
            "label_truncated": len(bookmark["label"]) > 256,
            "note": bookmark["note"][:4000], "note_truncated": len(bookmark["note"]) > 4000,
            "row_ids": bookmark["row_ids"][:200], "row_count": len(bookmark["row_ids"]),
            "row_ids_complete": len(bookmark["row_ids"]) <= 200} for bookmark in bookmarks["items"]]
        claims = paged((content.get("bpic19_pipeline") or {}).get("literature_claims", []), page["claims_offset"], 10)
        return _answer(RecoverInvestigationMetadataAnswer, _envelope("recover_investigation_metadata_answer", given) | {
            "saved_revision_id": revision.saved_revision_id, "investigation_id": revision.investigation_id,
            "status": "historical_metadata_only", "metadata_integrity": "saved_content_hash_verified",
            "outputs_restored": False, "selection_restored": False, "source_verified": False,
            "metadata": {"name": content["name"][:256], "name_truncated": len(content["name"]) > 256,
                "base_identity": content["base_identity"], "selection_identity": content["selection_identity"],
                "notes": notes, "bookmarks": bookmarks, "literature_claims": claims}})

    def _save(self, request: SaveInvestigationRequest1, given: dict) -> SavingReply:
        workspace = self._imports.opened_workspace(given["workspace_id"])
        if isinstance(workspace, Problem):
            return _problem(SAVE, workspace, given)
        if given.get("bpic19_pipeline") is not None and given.get("expected_revision_id") is not None:
            store = SavedInvestigations(workspace)
            head = store.head(given["investigation_id"])
            # Publication still decides stale/foreign expected revisions using
            # the established conflict contract. Inspect only the actual head.
            if not isinstance(head, Problem) and head.latest_revision_id == given["expected_revision_id"]:
                prior = store.revision(given["expected_revision_id"])
                if isinstance(prior, Problem): return _problem(SAVE, prior, given)
                integrity = _retained_pipeline_integrity(prior)
                if integrity is not None: return _problem(SAVE, integrity, given)
        prepared_manifest = retained_prepared_manifest(workspace, given.get("bpic19_prepared_assessments"))
        if isinstance(prepared_manifest, Problem): return _problem(SAVE, prepared_manifest, given)
        reference = given.get("score_run_ref")
        unreferable = _score_reference_problem(workspace, reference, given["base_identity"])
        if unreferable is not None:
            return _problem(SAVE, unreferable, given)
        content = {
            "format_version": 1,
            "name": given["name"],
            "base_identity": given["base_identity"],
            "selection_identity": given["selection_identity"],
            "selection_recipe": given["selection_recipe"],
            "context_policy": given["context_policy"],
            "comparison": _whole_numbers(given["comparison"]),
            "notes": given["notes"],
            "bookmarks": given["bookmarks"],
            "score_run_ref": reference,
        }
        if given.get("bpic19_pipeline") is not None:
            content["bpic19_pipeline"] = given["bpic19_pipeline"]
        if given.get("bpic19_prepared_assessments") is not None:
            content["bpic19_prepared_assessments"] = given["bpic19_prepared_assessments"]
        for optional in ("outcome", "comparison_parent"):
            if given.get(optional) is not None:
                content[optional] = _whole_numbers(given[optional])
        question = self._question(workspace, content, None)
        if isinstance(question, Problem):
            return _problem(SAVE, question, given)
        pipeline = self._pipeline(workspace.workspace_id, content, question)
        if isinstance(pipeline, Problem):
            return _problem(SAVE, pipeline, given)
        presentation = given.get("presentation_state")
        # Stages are presentation, bound to the reading they were defined for: saved with another reading's, or
        # inconsistent, they are refused rather than kept to be applied to a log they do not belong to.
        stages = _stages_problem(presentation, given["base_identity"]) or _requests_problem(presentation, given["base_identity"])
        if stages is not None:
            return _refused(SAVE, "invalid_request", stages[0] + " Nothing was saved.", given, stages[1])
        published = SavedInvestigations(workspace).publish(
            given["investigation_id"],
            given["expected_revision_id"],
            content,
            {
                "application_version": __version__,
                "analytics_version": IMPLEMENTATION_VERSION,
                "source": dict(question.source),
                "preparation": dict(question.preparation.descriptor),
                "results": {**_results(question), **({"bpic19_pipeline": pipeline} if pipeline is not None else {}),
                            **({"bpic19_prepared_assessments": prepared_manifest} if prepared_manifest is not None else {})},
                "presentation_state": presentation,
            },
        )
        if isinstance(published, Problem):
            return _problem(SAVE, published, given)
        if isinstance(published, Conflict):
            return _sent_refusal(
                saving_refusal(
                    SAVE,
                    "revision_conflict",
                    "This investigation was saved again since you opened it, so your save would replace a revision "
                    "you have not seen. Nothing was saved. Reopen the latest revision, then save your changes again.",
                    echo=import_echo(given),
                    field="expected_revision_id",
                    investigation_id=published.investigation_id,
                    expected_revision_id=published.expected_revision_id,
                    current_revision_id=published.current_revision_id,
                )
            )
        return _answer(
            SaveInvestigationAnswer,
            _envelope("save_investigation_answer", given)
            | {
                "revision": published.revision.revision(),
                "created_investigation": published.created_investigation,
                "semantic_change": published.semantic_change,
                "recovery": {"presentation_state": presentation, "warnings": []},
                **({"bpic19_outputs": pipeline} if pipeline is not None else {}),
                **({"bpic19_prepared_outputs": prepared_manifest} if prepared_manifest is not None else {}),
            },
        )

    def _list_saved(self, request: ListSavedRequest, given: dict) -> SavingReply:
        workspace = self._imports.opened_workspace(given["workspace_id"])
        if isinstance(workspace, Problem):
            return _problem(LIST_SAVED, workspace, given)
        store = SavedInvestigations(workspace)
        heads = store.heads()
        if isinstance(heads, Problem):
            return _problem(LIST_SAVED, heads, given)
        listed: list[tuple[str, dict]] = []
        for head in heads:
            revision = store.revision(head.latest_revision_id)
            if isinstance(revision, Problem):
                return _problem(LIST_SAVED, Problem(revision.code, revision.message, None), given)
            lineage = _lineage(store, revision)
            summary = _summary(revision, lineage)
            if summary is None:
                return _problem(LIST_SAVED, _unreadable_results(revision), given)
            listed.append((revision.saved_utc, summary))
        listed.sort(key=lambda item: (item[0], item[1]["investigation_id"]), reverse=True)
        return _answer(
            ListSavedAnswer,
            _envelope("list_saved_answer", given) | {"investigations": [summary for _, summary in listed]},
        )

    def _reopen(self, request: ReopenInvestigationRequest, given: dict) -> SavingReply:
        workspace = self._imports.opened_workspace(given["workspace_id"])
        if isinstance(workspace, Problem):
            return _problem(REOPEN, workspace, given)
        revision = SavedInvestigations(workspace).revision(given["saved_revision_id"])
        if isinstance(revision, Problem):
            return _problem(REOPEN, revision, given)
        if revision.analytics_version != IMPLEMENTATION_VERSION:
            return _refused(
                REOPEN,
                "incompatible_saved_revision",
                f"This investigation was saved with analytics version {revision.analytics_version}; this application "
                f"computes with version {IMPLEMENTATION_VERSION}, so its figures could differ from the saved ones. "
                f"Reopen it with the application version that saved it, or open its source again and save a new "
                f"investigation.",
                given,
                "saved_revision_id",
            )
        integrity = _retained_pipeline_integrity(revision)
        if integrity is not None: return _problem(REOPEN, integrity, given)
        prepared_manifest = retained_prepared_manifest(workspace, revision.content.get("bpic19_prepared_assessments"))
        if isinstance(prepared_manifest, Problem): return _problem(REOPEN, prepared_manifest, given)
        if revision.results.get("bpic19_prepared_assessments") != prepared_manifest:
            return _problem(REOPEN, Problem("checksum_mismatch", "The saved prepared manifest differs from its immutable references. Nothing was scored again.", "saved_revision_id"), given)
        unreferable = _score_reference_problem(
            workspace, revision.content.get("score_run_ref"), revision.content["base_identity"]
        )
        if unreferable is not None:
            return _problem(REOPEN, Problem(unreferable.code, unreferable.message, "saved_revision_id"), given)
        question = self._question(workspace, revision.content, revision)
        if isinstance(question, Problem):
            # Preserve the actual source reference for scoped BPIC integrity
            # failures; generic import/Resolution reopen fields stay unchanged.
            source_integrity = (revision.content.get("bpic19_pipeline") is not None
                                and question.field == "base_identity.source_id"
                                and question.code in {"artifact_unavailable", "checksum_mismatch"})
            return _problem(REOPEN, Problem(question.code, question.message,
                                           question.field if source_integrity else "saved_revision_id"), given)
        differs = _differing_results(revision, question)
        if differs is not None:
            return _problem(REOPEN, Problem(differs.code, differs.message, "saved_revision_id"), given)
        pipeline = self._pipeline(workspace.workspace_id, revision.content, question)
        if isinstance(pipeline, Problem):
            return _problem(REOPEN, pipeline, given)
        if revision.results.get("bpic19_pipeline") != pipeline:
            return _problem(REOPEN, Problem("identity_mismatch", "The saved pipeline output differs from its source replay. The saved revision was not overwritten.", "saved_revision_id"), given)
        registry = self._imports.selections
        registry.keep(workspace.workspace_id, question.parent)
        registry.keep(workspace.workspace_id, question.selection)
        if question.comparison is not None:
            keep_comparison(registry, workspace.workspace_id, question.prepared, question.comparison)
        selected = question.selection.to_dict()
        return _answer(
            ReopenInvestigationAnswer,
            _envelope("reopen_investigation_answer", given)
            | {
                "revision": revision.revision(),
                **({"bpic19_outputs": pipeline} if pipeline is not None else {}),
                **({"bpic19_prepared_outputs": prepared_manifest} if prepared_manifest is not None else {}),
                "restored_selection": {
                    "identity": selected["identity"],
                    "parent_identity": question.parent.identity_dict(),
                    "parent": selected["parent"],
                    "kept": selected["kept"],
                    "removed": selected["removed"],
                    "unevaluable": selected["unevaluable"],
                    "predicate_results": selected["predicate_results"],
                },
                "restored_comparison_id": None
                if question.comparison is None
                else question.comparison["comparison_id"],
                "recovery": _recovery(revision.presentation_state, revision.content["base_identity"]),
            },
        )

    # The question recomputed ------------------------------------------------------------------

    def _question(
        self, workspace: Workspace, content: Mapping[str, object], saved: StoredRevision | None
    ) -> Question | Problem:
        """Recompute a question from its stored source; ``saved`` is the revision being reopened, if any."""
        base = content["base_identity"]
        named = content["selection_identity"]
        assert isinstance(base, dict) and isinstance(named, dict)
        for name in _BINDING:
            if named[name] != base[name]:
                return Problem(
                    "identity_mismatch",
                    f"The selection belongs to another {_IDENTITY_NAMES[name]} than the base population "
                    f"({named[name]} instead of {base[name]}). Select the incidents of this preparation again.",
                    f"selection_identity.{name}",
                )
        bpic = content.get("bpic19_pipeline") is not None
        source = self._source(workspace, str(base["source_id"]), saved, bpic=bpic)
        if isinstance(source, Problem):
            return source
        preparation = self._preparation(workspace, base, saved, bpic=bpic)
        if isinstance(preparation, Problem):
            return preparation
        found = self._imports.prepared_snapshot(workspace, str(base["preparation_id"]), "base_identity.preparation_id")
        if isinstance(found, Problem) or isinstance(found, PackageRefusal):
            if isinstance(found, Problem) and found.code in ("source_unavailable", "workspace_unavailable"):
                return found
            logger.info("A kept preparation could not be prepared again: %s", found.code)
            return Problem(
                "preparation_changed",
                f"The stored source, read with the confirmed recipe, no longer gives the preparation "
                f"{base['preparation_id']}: this version of the application reads it differently. "
                "Confirm the interpretation of the source again and save a new investigation.",
                "base_identity.preparation_id",
            )
        prepared = found[0]
        computed = prepared.identity_dict()
        for name in _IDENTITY_NAMES:
            if computed[name] != base[name]:
                return Problem(
                    "identity_mismatch",
                    f"The {_IDENTITY_NAMES[name]} of the preparation is {computed[name]}, not the saved "
                    f"{base[name]}. Open the incidents of this preparation again.",
                    f"base_identity.{name}",
                )
        recipe = content["selection_recipe"]
        assert isinstance(recipe, dict)
        try:
            predicates = [package_predicate(item) for item in recipe["predicates"]]
            selection = select_cases(prepared, predicates, recipe["parent_case_ids"])
            parent = select_cases(prepared, (), recipe["parent_case_ids"])
        except SelectionError as error:
            return Problem(
                "selection_mismatch",
                f"The selection steps cannot be applied to this preparation: {error}",
                "selection_recipe",
            )
        if selection.identity_dict() != named:
            return Problem(
                "selection_mismatch",
                f"The selection steps on their parent keep {selection.kept.case_count} incidents as population "
                f"{selection.population_id}, not the population {named['population_id']} named as the selection. "
                "Select the incidents again.",
                "selection_identity.population_id",
            )
        comparison = _comparison(prepared, base, content.get("comparison"))
        if isinstance(comparison, Problem):
            return comparison
        problem = _bookmark_problem(prepared, base, parent, selection, comparison, content["bookmarks"])
        if problem is not None:
            return problem
        problem = _described_problem(prepared, recipe, content)
        if problem is not None:
            return problem
        return Question(prepared, source, preparation, parent, selection, comparison)

    def _pipeline(self, workspace_id: str, content: dict, question: Question):
        registry = self._imports.selections
        prefixes = [question.parent]
        pipeline = content.get("bpic19_pipeline")
        recipe = content["selection_recipe"]
        if pipeline is not None:
            try:
                predicates = [package_predicate(item) for item in recipe["predicates"]]
                prefixes.extend(select_cases(question.prepared, predicates[:length], recipe["parent_case_ids"])
                                for length in range(1, len(predicates)))
            except SelectionError as error:
                return Problem("selection_mismatch", f"An intermediate selection prefix cannot be replayed: {error}", "selection_recipe")
        if recipe["predicates"]: prefixes.append(question.selection)
        if pipeline is not None:
            for index, action in enumerate(pipeline["actions"]):
                if "selection_prefix_length" not in action: continue
                length = action["selection_prefix_length"]
                field = f"bpic19_pipeline.actions.{index}.selection_prefix_length"
                if length is None:
                    computed = question.prepared.identity_dict()
                elif type(length) is int and 0 <= length < len(prefixes):
                    computed = prefixes[length].identity_dict()
                else:
                    return Problem("identity_mismatch", "The declared selection-prefix position is outside this saved recipe.", field)
                if action["identity"] != computed:
                    return Problem("identity_mismatch", "The action identity differs from its declared, replayed selection prefix.", field)
        # Only populations computed from this frozen parent and these exact steps
        # enter the registry. Caller-supplied action identities are never registered.
        for selection in prefixes: registry.keep(workspace_id, selection)
        return replay_pipeline(self._imports, workspace_id, content.get("bpic19_pipeline"),
                               [question.prepared.identity_dict(), *[selection.identity_dict() for selection in prefixes]],
                               selection_recipe=recipe,
                               selection_prefix_identities=[selection.identity_dict() for selection in prefixes],
                               selection_prefix_supports=([{"case_ids": selection.kept.case_ids,
                                   "case_count": selection.kept.case_count, "record_count": selection.kept.record_count} for selection in prefixes]
                                   if pipeline is not None and any("selection_keep" in action for action in pipeline["actions"]) else None))

    def _source(
        self, workspace: Workspace, source_id: str, saved: StoredRevision | None, *, bpic: bool = False
    ) -> Mapping[str, object] | Problem:
        if bpic:
            integrity = workspace.reference_integrity("source", source_id)
            if integrity.state != "available":
                code = "checksum_mismatch" if integrity.state == "checksum_invalid" else "artifact_unavailable"
                return Problem(code, f"The saved BPIC source reference {source_id} is {integrity.state}. Original import/source-history refusals are unchanged; nothing was rebound or repaired.", "base_identity.source_id")
            assert integrity.record is not None
            return integrity.record
        state = workspace.source_bytes_state(source_id)
        name = f"the file {saved.source.get('filename')!s} " if saved is not None else "the source file "
        if state == "missing":
            return Problem(
                "source_unavailable",
                f"The bytes of {name}({source_id}) are no longer stored in the workspace. Add the same file again "
                "in the Data area; it is recognised by its bytes. Then reopen.",
                "base_identity.source_id",
            )
        if state == "changed":
            return Problem(
                "source_changed",
                f"The stored bytes of {name}({source_id}) were changed outside the application, so they are no "
                "longer the saved source. Add the original file again in the Data area, then reopen.",
                "base_identity.source_id",
            )
        record = workspace.source(source_id)
        if isinstance(record, Problem):
            return record
        return record.to_dict()

    def _preparation(
        self, workspace: Workspace, base: Mapping[str, object], saved: StoredRevision | None, *, bpic: bool = False
    ) -> StoredPreparation | Problem:
        """The kept preparation of the base identity; when reopening, prepared again from the saved recipe if gone."""
        preparation_id = str(base["preparation_id"])
        record = workspace.preparation(preparation_id)
        if bpic and isinstance(record, Problem) and record.code == "preparation_unavailable":
            path = workspace.path / "preparations" / (preparation_id.rsplit(":", 1)[-1] + ".json")
            if path.exists():
                try: path.read_bytes()
                except OSError:
                    return Problem("artifact_unavailable", "The saved BPIC preparation record cannot be read. Nothing was repaired.", "base_identity.preparation_id")
                return Problem("checksum_mismatch", "The saved BPIC preparation record is malformed. Its recipe was not replaced from defaults or metadata.", "base_identity.preparation_id")
        if isinstance(record, Problem) and record.code == "preparation_unavailable" and saved is not None:
            record = _prepared_again(workspace, base, saved)
        if isinstance(record, Problem):
            return Problem(record.code, record.message, "base_identity.preparation_id")
        if bpic:
            descriptor = record.descriptor
            try:
                expected = content_identity("preparation", {"format_version": 1, "source_id": descriptor["source_id"],
                    "parser_version": PARSER_VERSION, "dialect": descriptor.get("dialect"), "mapping": descriptor.get("mapping"),
                    "policies": descriptor.get("policies"), "implementation_version": IMPLEMENTATION_VERSION})
            except (KeyError, ValueError, TypeError):
                expected = None
            if expected != preparation_id:
                return Problem("checksum_mismatch", "The saved BPIC preparation descriptor no longer matches its content identity. Nothing was rebound, cached or repaired.", "base_identity.preparation_id")
        if record.source_id != base["source_id"]:
            return Problem(
                "identity_mismatch",
                f"The preparation {preparation_id} reads the source {record.source_id}, not {base['source_id']}.",
                "base_identity.source_id",
            )
        if saved is not None:
            for part in ("dialect", "mapping", "policies"):
                if record.descriptor.get(part) != saved.preparation.get(part):
                    return Problem(
                        "preparation_changed",
                        f"The preparation {preparation_id} kept in the workspace has another {part} than the saved "
                        "recipe. Confirm the interpretation of the source again and save a new investigation.",
                        "base_identity.preparation_id",
                    )
        return record


def _prepared_again(workspace: Workspace, base: Mapping[str, object], saved: StoredRevision) -> StoredPreparation | Problem:
    """Prepare the stored source again with the saved recipe, and keep the preparation when it is the same."""
    recipe = saved.preparation
    raw = workspace.source_file(str(base["source_id"]))
    if isinstance(raw, Problem):
        return raw
    if not all(isinstance(recipe.get(part), dict) for part in ("dialect", "mapping", "policies")):
        return Problem(
            "preparation_unavailable",
            "The preparation is no longer kept in the workspace, and the saved recipe is incomplete. "
            "Confirm the interpretation of the source again.",
        )
    try:
        result = prepare(raw, recipe["dialect"], recipe["mapping"], recipe["policies"], True)
    except SourceChanged:
        return source_changed()
    if isinstance(result, PackageRefusal) or not isinstance(result, PreparationResult) or result.preparation is None:
        reason = result.message if isinstance(result, PackageRefusal) else "the saved recipe gives no ready preparation"
        return Problem(
            "preparation_unavailable",
            f"The preparation is no longer kept in the workspace and cannot be prepared again from the saved recipe: "
            f"{reason} Confirm the interpretation of the source again.",
        )
    if result.preparation.preparation_id != base["preparation_id"]:
        return Problem(
            "preparation_changed",
            f"The saved recipe now gives the preparation {result.preparation.preparation_id}, not the saved "
            f"{base['preparation_id']}. Confirm the interpretation of the source again and save a new investigation.",
        )
    interpretation = result.to_dict()
    return workspace.store_preparation(
        interpretation["preparation"], result.preparation.identity_dict(), interpretation["report"]
    )


def _comparison(
    prepared: PreparedData, base: Mapping[str, object], saved: object
) -> dict | None | Problem:
    if saved is None:
        return None
    assert isinstance(saved, dict)
    answer = compared(
        prepared,
        str(saved["kind"]),
        base,
        saved["parent_case_ids"],
        saved["context_column_index"],
        saved["context_policy"],
        saved["definition"],
    )
    if isinstance(answer, PackageRefusal):
        field = "comparison" if answer.field in (None, "identity") else f"comparison.{answer.field}"
        return Problem(
            "comparison_unavailable",
            f"The comparison cannot be computed on this preparation: {answer.message}",
            field,
        )
    if answer["comparison_id"] != saved["comparison_id"]:
        return Problem(
            "comparison_mismatch",
            f"The comparison of these groups is {answer['comparison_id']}, not the saved {saved['comparison_id']}. "
            "Compare the groups again.",
            "comparison.comparison_id",
        )
    return answer


def _described_problem(prepared: PreparedData, recipe: Mapping[str, object], content: Mapping[str, object]) -> Problem | None:
    """Why the description of the comparison's parent or the saved outcome does not fit this question, or ``None``.

    Retained steps must give exactly the comparison's parent from the selection's parent: a description that does not
    is refused, never shown beside a parent it does not describe. A saved outcome must read a mapped context column.
    """
    described = content.get("comparison_parent")
    comparison = content.get("comparison")
    if described is not None:
        if comparison is None:
            return Problem("comparison_mismatch", "A parent is described without a comparison. Save the comparison with it, or leave the description out.", "comparison_parent")
        retained = described["retained_predicates"]
        if retained:
            try:
                kept = select_cases(prepared, [package_predicate(item) for item in retained], recipe["parent_case_ids"]).kept.case_ids
            except SelectionError as error:
                return Problem("comparison_mismatch", f"The steps describing the comparison's parent cannot be applied: {error}", "comparison_parent.retained_predicates")
            if list(kept) != sorted(comparison["parent_case_ids"]):
                return Problem("comparison_mismatch", "The steps describing the comparison's parent do not keep exactly its incidents. Compare again, then save.",
                               "comparison_parent.retained_predicates")
    outcome = content.get("outcome")
    if outcome is not None and outcome["context_column_index"] not in prepared.mapping["context_columns"]:
        return Problem("invalid_parameter", "The saved outcome reads a column that is not a context column of this preparation.", "outcome.context_column_index")
    return None


def _bookmark_problem(
    prepared: PreparedData,
    base: Mapping[str, object],
    parent: SelectionResult,
    selection: SelectionResult,
    comparison: Mapping[str, object] | None,
    bookmarks: object,
) -> Problem | None:
    """Why a bookmark is not bound to this question, or ``None`` when every one is."""
    populations: dict[str, tuple[Mapping[str, object], frozenset[str]]] = {
        str(base["population_id"]): (base, frozenset(prepared.histories)),
        parent.population_id: (parent.identity_dict(), frozenset(parent.parent.case_ids)),
        selection.population_id: (selection.identity_dict(), frozenset(selection.kept.case_ids)),
    }
    if comparison is not None:
        for role in ("target", "reference"):
            group = comparison[role]
            populations[group["identity"]["population_id"]] = (group["identity"], frozenset(group["included"]["case_ids"]))
    assert isinstance(bookmarks, list)
    for index, bookmark in enumerate(bookmarks):
        at = f"bookmarks.{index}"
        named = populations.get(bookmark["identity"]["population_id"])
        if named is None or dict(named[0]) != bookmark["identity"]:
            return Problem(
                "invalid_bookmark",
                f"The bookmark {bookmark['label']!r} names a population that is not the base population, the parent, "
                "the selection or a compared group of this investigation. Remove it or bookmark the incident again.",
                f"{at}.identity",
            )
        if bookmark["case_id"] not in named[1]:
            return Problem(
                "invalid_bookmark",
                f"The bookmark {bookmark['label']!r} names the incident {bookmark['case_id']!r}, which is not in the "
                "population it names. Remove it or bookmark the incident again.",
                f"{at}.case_id",
            )
        rows = {record.row_id for record in prepared.histories[bookmark["case_id"]]}
        foreign = [row_id for row_id in bookmark["row_ids"] if row_id not in rows]
        if foreign:
            return Problem(
                "invalid_bookmark",
                f"The bookmark {bookmark['label']!r} names the row {foreign[0]}, which is not a record of the "
                f"incident {bookmark['case_id']!r}. Remove it or bookmark the records again.",
                f"{at}.row_ids",
            )
    return None


# What is kept beside the content ---------------------------------------------------------------


def _counts(identity: Mapping[str, object], case_count: int, record_count: int) -> dict[str, object]:
    return {"identity": dict(identity), "case_count": case_count, "record_count": record_count}


def _support_counts(support: Mapping[str, object]) -> dict[str, object]:
    return {"case_count": support["case_count"], "record_count": support["record_count"]}


def _results(question: Question) -> dict[str, object]:
    """The identities and counts of the results at the time of saving."""
    prepared, selection, parent = question.prepared, question.selection, question.parent
    answered = selection.to_dict()
    comparison = question.comparison
    return {
        "base": _counts(prepared.identity_dict(), len(prepared.histories), sum(map(len, prepared.histories.values()))),
        "parent": _counts(parent.identity_dict(), parent.parent.case_count, parent.parent.record_count),
        "selection": {
            "identity": answered["identity"],
            "kept": _support_counts(answered["kept"]),
            "removed": _support_counts(answered["removed"]),
            "unevaluable": _support_counts(answered["unevaluable"]),
        },
        "comparison": None
        if comparison is None
        else {
            "comparison_id": comparison["comparison_id"],
            "parent": _counts(comparison["parent_identity"], comparison["parent"]["case_count"], comparison["parent"]["record_count"]),
            "target": _counts(
                comparison["target"]["identity"],
                comparison["target"]["included"]["case_count"],
                comparison["target"]["included"]["record_count"],
            ),
            "reference": _counts(
                comparison["reference"]["identity"],
                comparison["reference"]["included"]["case_count"],
                comparison["reference"]["included"]["record_count"],
            ),
        },
    }


def _differing_results(saved: StoredRevision, question: Question) -> Problem | None:
    """Why the recomputed results are not the saved ones, or ``None`` when they are."""
    now = _results(question)
    for part, code in (("base", "identity_mismatch"), ("parent", "selection_mismatch"), ("selection", "selection_mismatch"), ("comparison", "comparison_mismatch")):
        if saved.results.get(part) != now[part]:
            return Problem(
                code,
                f"Recomputed from the stored source, the {part} of this investigation has other incidents or records "
                "than when it was saved, so it is not shown as the saved state. Open the source again and save a "
                "new investigation.",
            )
    return None


def _summary(revision: StoredRevision, lineage: list[dict[str, object]] | None = None) -> dict[str, object] | None:
    selection = revision.results.get("selection")
    kept = selection.get("kept") if isinstance(selection, dict) else None
    if not isinstance(kept, dict) or type(kept.get("case_count")) is not int or type(kept.get("record_count")) is not int:
        return None
    content = revision.content
    comparison = content["comparison"]
    return {
        "investigation_id": revision.investigation_id,
        "latest_revision_id": revision.saved_revision_id,
        "name": content["name"],
        "source_id": content["base_identity"]["source_id"],
        "preparation_id": content["base_identity"]["preparation_id"],
        "selected_case_count": kept["case_count"],
        "selected_record_count": kept["record_count"],
        "comparison_kind": None if comparison is None else comparison["kind"],
        "has_score_run": content["score_run_ref"] is not None,
        "source_validation": "not_checked",
        "saved_utc": revision.saved_utc,
        "snapshot_cutoff": _cutoff(revision.preparation),
        **({"revisions": lineage} if lineage is not None else {}),
    }


def _cutoff(preparation: Mapping[str, object]) -> str | None:
    """The snapshot cutoff the saved preparation declares, as its time policy holds it; none where it holds none."""
    policies = preparation.get("policies") if isinstance(preparation, Mapping) else None
    time = policies.get("time") if isinstance(policies, Mapping) else None
    parameters = time.get("parameters") if isinstance(time, Mapping) else None
    if not isinstance(parameters, Mapping):
        return None
    value = parameters.get("snapshot_cutoff_utc", parameters.get("snapshot_cutoff_local"))
    return value if isinstance(value, str) and value else None


def _unreadable_results(revision: StoredRevision) -> Problem:
    return Problem(
        "malformed_saved_revision",
        f"The saved revision {revision.saved_revision_id} has no readable counts of its results. Restore it from a "
        "backup, or move it out of the workspace folder.",
    )


def _stages_problem(presentation: object, base_identity: Mapping[str, object]) -> tuple[str, str] | None:
    """Why the stages of a presentation cannot belong to this reading, with the field; None when they can or there are none."""
    stages = presentation.get("stages") if isinstance(presentation, Mapping) else None
    if not isinstance(stages, Mapping):
        return None
    field = "presentation_state.stages"
    if stages.get("preparation_id") != base_identity.get("preparation_id"):
        return ("The stages were defined for another reading of the source; they belong to the preparation they were defined for.",
                field + ".preparation_id")
    ids = [stage["id"] for stage in stages["stages"]]
    names = [stage["name"].casefold() for stage in stages["stages"]]
    if len(set(ids)) != len(ids) or len(set(names)) != len(names):
        return "Two stages have the same id or the same name.", field + ".stages"
    activities = [assignment["activity"] for assignment in stages["assignments"]]
    if len(set(activities)) != len(activities):
        return "An activity is put into more than one stage.", field + ".assignments"
    if any(assignment["stage_id"] not in ids for assignment in stages["assignments"]):
        return "An activity is put into a stage that is not defined.", field + ".assignments"
    return None


def _requests_problem(presentation: object, base_identity: Mapping[str, object]) -> tuple[str, str] | None:
    """Why the definition of requests of a presentation cannot belong to this reading, with the field; None when it can or there is none."""
    requests = presentation.get("requests") if isinstance(presentation, Mapping) else None
    if not isinstance(requests, Mapping):
        return None
    field = "presentation_state.requests"
    if requests.get("preparation_id") != base_identity.get("preparation_id"):
        return ("The definition of requests and answers was made for another reading of the source; it belongs to the preparation it was made for.",
                field + ".preparation_id")
    if set(requests["request_activities"]) & set(requests["answer_activities"]):
        return "An activity is both a request and an answer.", field + ".answer_activities"
    return None


def _recovery(stored: object, base_identity: Mapping[str, object] | None = None) -> dict[str, object]:
    """The saved presentation, or none with a warning when it cannot be used; the question is unaffected."""
    if stored is None:
        return {"presentation_state": None, "warnings": []}
    try:
        PresentationRecovery.model_validate(stored, strict=True)
    except ValidationError:
        return {
            "presentation_state": None,
            "warnings": [
                {
                    "code": "presentation_invalid",
                    "message": "The saved view and sort order could not be read; the investigation opens in the "
                    "incident table instead. The incidents and every count are as saved.",
                }
            ],
        }
    if base_identity is None:
        return {"presentation_state": stored, "warnings": []}
    # What cannot belong to this reading is left out and said to be; the rest of the presentation and the question are as saved.
    kept, warnings = dict(stored), []
    for key, check, code, what in (("stages", _stages_problem, "stages_not_applied", "The stages saved with this investigation"),
                                   ("requests", _requests_problem, "requests_not_applied", "The definition of requests saved with this investigation")):
        problem = check(stored, base_identity)
        if problem is not None:
            kept.pop(key, None)
            warnings.append({"code": code, "message": f"{what} {'were' if key == 'stages' else 'was'} not applied: " + problem[0][0].lower() + problem[0][1:]
                             + " The incidents and every count are as saved."})
    return {"presentation_state": kept if warnings else stored, "warnings": warnings}


def _whole_numbers(value: object) -> object:
    """A JSON value with every whole number written as one: ``4.0`` is kept as ``4``."""
    if isinstance(value, dict):
        return {key: _whole_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_whole_numbers(item) for item in value]
    if type(value) is float and value.is_integer():
        return int(value)
    return value


# Replies ---------------------------------------------------------------------------------------


def _envelope(message_type: str, given: Mapping[str, object]) -> dict[str, object]:
    return {
        "schema_version": SCHEMA_VERSION,
        "message_type": message_type,
        "request_id": given["request_id"],
        "query_revision": given["query_revision"],
        "workspace_id": given["workspace_id"],
    }


def _answering(
    operation: str,
    parsed: tuple[BaseModel, dict] | SavingRefusal,
    answer: Callable[[BaseModel, dict], SavingReply],
) -> SavingReply:
    if isinstance(parsed, SavingRefusal):
        return _sent_refusal(parsed)
    request, given = parsed
    try:
        return answer(request, given)
    except Exception:
        logger.exception("The %s operation failed unexpectedly", operation)
        return _refused(
            operation,
            "computation_failed",
            "The answer could not be computed. Try again; if it fails again, the application needs to be repaired.",
            given,
        )


def _answer(model: type[BaseModel], body: dict) -> SavingReply:
    """Check an answer against its generated model and send it with its own values."""
    try:
        model.model_validate(body)
    except ValidationError as error:
        first = error.errors(include_url=False)[0]
        raise ValueError(
            f"A {body.get('message_type')} answer is outside the contract at "
            f"{'.'.join(str(part) for part in first['loc'])}: {first['msg']}"
        ) from None
    return SavingReply(200, body)


def _retained_pipeline_integrity(revision: StoredRevision) -> Problem | None:
    """Verify recorded canonical output receipts before any operator replay."""
    pipeline = revision.content.get("bpic19_pipeline")
    if pipeline is None: return None
    manifest = revision.results.get("bpic19_pipeline")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("outputs"), list):
        return Problem("artifact_unavailable", "The saved BPIC output manifest is missing. Nothing was computed again.", "saved_revision_id")
    expected = [(action["operation"], action["definition_id"]) for action in pipeline["actions"] if action["operation"] != "bpic19_method_gate"]
    present = []
    for index, entry in enumerate(manifest["outputs"]):
        field = f"results.bpic19_pipeline.outputs.{index}"
        if not isinstance(entry, dict) or not isinstance(entry.get("output"), dict):
            return Problem("artifact_unavailable", "A saved BPIC output reference is missing.", field)
        digest = entry.get("sha256")
        try:
            raw = json.dumps(entry["output"], ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        except (ValueError, TypeError):
            return Problem("checksum_mismatch", "A saved BPIC output is not its recorded canonical payload.", field)
        if not isinstance(digest, str) or not re.fullmatch("[a-f0-9]{64}", digest) or hashlib.sha256(raw).hexdigest() != digest:
            return Problem("checksum_mismatch", "A saved BPIC output failed its recorded canonical checksum. Notes remain historical metadata only.", field)
        present.append((entry.get("operation"), entry.get("definition_id")))
    if present != expected:
        return Problem("artifact_unavailable", "The saved BPIC manifest is missing an ordered output reference or names another definition.", "results.bpic19_pipeline.outputs")
    return None


def _score_reference_problem(
    workspace: Workspace, reference: object, base_identity: Mapping[str, object]
) -> Problem | None:
    """Why a saved investigation cannot refer to this score run, or nothing when it can or refers to none.

    The reference names a run kept in the workspace, the population that run scored and its
    calibration. All three are compared with the kept run, and the run must have been scored on the
    preparation the investigation is about. Nothing is scored here: the run is only looked up.
    """
    if reference is None:
        return None
    assert isinstance(reference, Mapping)
    run = workspace.run(str(reference["score_run_id"]))
    if isinstance(run, Problem):
        return Problem("score_reference_unavailable", run.message, "score_run_ref.score_run_id")
    identity = run.get("identity") if isinstance(run, Mapping) else None
    if not isinstance(identity, Mapping) or identity.get("run_id") != reference["score_run_id"]:
        return Problem(
            "score_reference_unavailable",
            "This score run is not kept in the workspace. Score the expectation again, or save without a score run.",
            "score_run_ref.score_run_id",
        )
    scored = identity.get("scored_population_identity")
    if not isinstance(scored, Mapping) or scored.get("population_id") != reference["scored_population_id"]:
        return Problem(
            "score_reference_unavailable",
            "The kept score run scored another population than the reference names.",
            "score_run_ref.scored_population_id",
        )
    if identity.get("calibration_id") != reference["calibration_id"]:
        return Problem(
            "score_reference_unavailable",
            "The kept score run has another calibration than the reference names.",
            "score_run_ref.calibration_id",
        )
    run_base = identity.get("base_identity")
    same_preparation = isinstance(run_base, Mapping) and all(
        run_base.get(name) == base_identity.get(name) for name in ("source_id", "preparation_id", "representation_id", "case_dictionary_id", "implementation_version")
    )
    if not same_preparation:
        return Problem(
            "score_reference_unavailable",
            "The kept score run was scored on another reading than this investigation is about.",
            "score_run_ref.score_run_id",
        )
    return None


def _problem(operation: str, problem: Problem, given: Mapping[str, object]) -> SavingReply:
    code = problem.code if problem.code in STATUS else "workspace_unavailable"
    return _refused(operation, code, problem.message, given, problem.field)


def _refused(
    operation: str, code: str, message: str, given: Mapping[str, object], field: str | None = None
) -> SavingReply:
    return _sent_refusal(saving_refusal(operation, code, message, echo=import_echo(given), field=field))


def _sent_refusal(refusal: SavingRefusal) -> SavingReply:
    return SavingReply(STATUS[refusal.code], refusal_body(refusal))


def _lineage(store: SavedInvestigations, revision: StoredRevision) -> list[dict[str, object]]:
    """The revisions an investigation's latest one replaces, newest first, as far as each can be read."""
    lineage: list[dict[str, object]] = []
    current: StoredRevision | Problem = revision
    seen: set[str] = set()
    while isinstance(current, StoredRevision) and current.saved_revision_id not in seen:
        seen.add(current.saved_revision_id)
        base = current.content["base_identity"]
        lineage.append({"saved_revision_id": current.saved_revision_id, "saved_utc": current.saved_utc,
                        "source_id": base["source_id"], "preparation_id": base["preparation_id"]})
        if current.replaces_revision_id is None:
            break
        current = store.revision(current.replaces_revision_id)
    return lineage
