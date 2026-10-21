"""Bind one finite profile subgroup or activity cohort to its actual whole-case selection step.

The profile and measures requests own field/reducer/policy interpretation. This module only
checks their supplied supports against a saved selection; it adds no evaluator.
"""
from __future__ import annotations

from .workspace import Problem

PROFILE_KEEP_POLICY = "bpic19.profile_group_keep.v1"
MEASURE_KEEP_POLICY = "bpic19.measure_cohort_keep.v1"
COMPLETION_KEEP_POLICY = "bpic19.completion_cohort_keep.v1"
INTERVAL_KEEP_POLICY = "bpic19.interval_side_keep.v1"
# Which operation may justify a Keep of which group kind, under which policy.
_KEEPS = {"activity_cohort": ("bpic19_measures", MEASURE_KEEP_POLICY),
          "completion_cohort": ("bpic19_cohorts", COMPLETION_KEEP_POLICY),
          "interval_side": ("bpic19_interval_comparison", INTERVAL_KEEP_POLICY)}


def keep_step_problem(action: dict, recipe: dict | None, prefix_identities: list[dict] | None,
                      source_base_identity: dict, field: str) -> Problem | None:
    keep = action.get("selection_keep")
    if keep is None:
        if "selection_keep" in action:
            return Problem("invalid_parameter", "A declared profile Keep is a complete association, not null.", field)
        return None
    operation, policy = _KEEPS.get(keep["group"]["kind"], ("bpic19_profile", PROFILE_KEEP_POLICY))
    if action["operation"] != operation:
        return Problem("invalid_parameter", "A Keep belongs only to the reviewed answer that supplies its group: a profile group to its profile, "
                       "an activity cohort to its measures, a completion stage to its cohorts and a side to its interval comparison.", field)
    if keep["policy_id"] != policy:
        return Problem("unsupported_policy", "This Keep names another group's policy.", field + ".policy_id")
    position = keep["step_index"]
    declared = action.get("selection_prefix_length", "absent")
    exact_base = declared is None and position == 0 and action["identity"] == source_base_identity
    exact_prefix = (type(declared) is int and declared == position and prefix_identities is not None
                    and position < len(prefix_identities) and action["identity"] == prefix_identities[position])
    if (recipe is None or prefix_identities is None or position >= len(recipe["predicates"])
            or not (exact_base or exact_prefix)):
        return Problem("identity_mismatch", "The profile Keep does not name its exact recorded selection parent and step.", field + ".step_index")
    predicate = recipe["predicates"][position]
    if predicate["kind"] != "case_id_in" or predicate["negate"] is not False:
        return Problem("selection_mismatch", "The typed group Keep differs from the actual complete-item predicate at this step.", f"selection_recipe.predicates.{position}")
    return None


def profile_keep_support(profile: dict, group: dict) -> dict | None:
    """Resolve only the explicitly named, already supplied profile support."""
    kind = group["kind"]
    if kind == "flow":
        return next((item for item in profile["flows"] if item["flow_id"] == group["flow_id"]), None)
    if kind == "flow_item_type":
        return next((item for item in profile["flow_item_types"]
                     if item["flow_id"] == group["flow_id"] and item["item_type_state"] == group["state"]
                     and item["item_type_value"] == group["item_type_value"]), None)
    source = {"unresolved": profile["unresolved"], "cross_check": profile["cross_checks"],
              "grain_issue": profile["grain"]["identity_issues"]}.get(kind)
    if source is not None:
        return next((item for item in source if item["state"] == group["state"]), None)
    if kind == "source_inclusion":
        review = profile.get("source_review")
        return review["retained"] if (review is not None and review.get("projection") is None
                                     and group["state"] == "retained") else None
    if kind == "attribute_value":
        view = profile.get("attribute_view")
        selected = None if view is None else view.get("selection")
        return selected if (view is not None and view["column_index"] == group["column_index"]
                            and selected is not None and selected["value"] == group["value"]) else None
    return None


def measure_keep_problem(answer: dict, keep: dict, recipe: dict | None,
                         prefix_supports: list[dict] | None, field: str) -> Problem | None:
    """The kept step holds exactly the replayed cohort, taken from exactly the measured parent."""
    members = answer["activity_cohorts"][keep["group"]["cohort"] + "_case_ids"]
    position = keep["step_index"]
    if recipe is None or prefix_supports is None or position + 1 >= len(prefix_supports):
        return Problem("identity_mismatch", "The actual activity cohort Keep step is unavailable.", field + ".step_index")
    if sorted(members) != sorted(recipe["predicates"][position]["case_ids"]):
        return Problem("selection_mismatch", "The complete item IDs differ from the replayed activity cohort. No membership was substituted.", f"selection_recipe.predicates.{position}.case_ids")
    parent, selected = prefix_supports[position], prefix_supports[position + 1]
    if (parent["case_count"], parent["record_count"]) != (answer["population_case_count"], answer["population_record_count"]):
        return Problem("selection_mismatch", "The activity cohort Keep denominator differs from its exact replayed parent.", field + ".group")
    if sorted(selected["case_ids"]) != sorted(members) or selected["case_count"] != len(members):
        return Problem("selection_mismatch", "The activity cohort differs from the complete histories in the replayed step.", field + ".group")
    return None


def completion_keep_support(cohorts: dict, support: str) -> dict:
    stage, _, state = support.partition("_")
    if stage in ("inclusion", "retention"):
        return cohorts[stage][state]
    wanted = "unknown" if support == "completion_unknown" else support
    return next(group for group in cohorts["completion_groups"] if group["state"] == wanted)


def completion_keep_problem(answer: dict, keep: dict, recipe: dict | None,
                            prefix_supports: list[dict] | None, field: str) -> Problem | None:
    """The kept step holds exactly the replayed stage's items and records, taken from exactly the reviewed parent."""
    cohorts = answer["cohorts"]
    support = completion_keep_support(cohorts, keep["group"]["support"])
    position = keep["step_index"]
    if recipe is None or prefix_supports is None or position + 1 >= len(prefix_supports):
        return Problem("identity_mismatch", "The actual completion cohort Keep step is unavailable.", field + ".step_index")
    if sorted(support["case_ids"]) != sorted(recipe["predicates"][position]["case_ids"]):
        return Problem("selection_mismatch", "The complete item IDs differ from the replayed completion cohort. No membership was substituted.", f"selection_recipe.predicates.{position}.case_ids")
    parent, selected = prefix_supports[position], prefix_supports[position + 1]
    if any(parent[key] != cohorts["original"][key] for key in ("case_count", "record_count")):
        return Problem("selection_mismatch", "The completion cohort Keep denominator differs from its exact replayed parent.", field + ".group")
    if sorted(selected["case_ids"]) != sorted(support["case_ids"]) or any(selected[key] != support[key] for key in ("case_count", "record_count")):
        return Problem("selection_mismatch", "The completion cohort differs from the complete histories in the replayed step.", field + ".group")
    return None


def interval_keep_problem(answer: dict, keep: dict, recipe: dict | None,
                          prefix_supports: list[dict] | None, field: str) -> Problem | None:
    """The kept step holds exactly the named side's items, taken from exactly the compared parent."""
    comparison, group = answer["comparison"], keep["group"]
    side = comparison[group["side"]]
    members = side["case_ids" if group["support"] == "items" else group["support"] + "_case_ids"]
    position = keep["step_index"]
    if recipe is None or prefix_supports is None or position + 1 >= len(prefix_supports):
        return Problem("identity_mismatch", "The actual interval side Keep step is unavailable.", field + ".step_index")
    if sorted(members) != sorted(recipe["predicates"][position]["case_ids"]):
        return Problem("selection_mismatch", "The complete item IDs differ from the replayed interval side. No membership was substituted.", f"selection_recipe.predicates.{position}.case_ids")
    parent, selected = prefix_supports[position], prefix_supports[position + 1]
    if (parent["case_count"], parent["record_count"]) != (comparison["parent"]["case_count"], comparison["parent"]["record_count"]):
        return Problem("selection_mismatch", "The interval side Keep denominator differs from its exact replayed parent.", field + ".group")
    if sorted(selected["case_ids"]) != sorted(members) or selected["case_count"] != len(members) or (
            group["support"] == "items" and selected["record_count"] != side["record_count"]):
        return Problem("selection_mismatch", "The interval side differs from the complete histories in the replayed step.", field + ".group")
    return None


def profile_keep_problem(action: dict, answer: dict, recipe: dict | None,
                         prefix_supports: list[dict] | None, field: str) -> Problem | None:
    keep = action.get("selection_keep")
    if keep is None:
        return None
    if keep["group"]["kind"] == "activity_cohort":
        return measure_keep_problem(answer, keep, recipe, prefix_supports, field)
    if keep["group"]["kind"] == "completion_cohort":
        return completion_keep_problem(answer, keep, recipe, prefix_supports, field)
    if keep["group"]["kind"] == "interval_side":
        return interval_keep_problem(answer, keep, recipe, prefix_supports, field)
    profile = answer.get("profile")
    support = None if profile is None else profile_keep_support(profile, keep["group"])
    if support is None:
        return Problem("invalid_parameter", "The recorded group is unavailable in this exact reviewed profile. No group was guessed from item IDs.", field + ".group")
    position = keep["step_index"]
    if recipe is None or prefix_supports is None or position + 1 >= len(prefix_supports):
        return Problem("identity_mismatch", "The actual profile Keep step is unavailable.", field + ".step_index")
    if support["case_ids"] != sorted(recipe["predicates"][position]["case_ids"]):
        return Problem("selection_mismatch", "The complete item IDs differ from the replayed typed group. No membership was substituted.", f"selection_recipe.predicates.{position}.case_ids")
    parent, selected = prefix_supports[position], prefix_supports[position + 1]
    if any(parent[key] != profile["population"][key] for key in ("case_count", "record_count")):
        return Problem("selection_mismatch", "The profile Keep denominator differs from its exact replayed parent.", field + ".group")
    if (tuple(support["case_ids"]) != selected["case_ids"]
            or any(selected[key] != support[key] for key in ("case_count", "record_count"))):
        return Problem("selection_mismatch", "The profile Keep support differs from the complete histories in the replayed group.", field + ".group")
    return None
