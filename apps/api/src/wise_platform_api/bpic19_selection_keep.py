"""Bind one finite profile subgroup to its actual whole-case selection step.

The profile request owns field/reducer/policy interpretation. This module only
checks its supplied supports against a saved selection; it adds no evaluator.
"""
from __future__ import annotations

from .workspace import Problem


def keep_step_problem(action: dict, recipe: dict | None, prefix_identities: list[dict] | None,
                      source_base_identity: dict, field: str) -> Problem | None:
    keep = action.get("selection_keep")
    if keep is None:
        if "selection_keep" in action:
            return Problem("invalid_parameter", "A declared profile Keep is a complete association, not null.", field)
        return None
    if action["operation"] != "bpic19_profile":
        return Problem("invalid_parameter", "A profile group Keep belongs only to its reviewed source profile.", field)
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


def profile_keep_problem(action: dict, answer: dict, recipe: dict | None,
                         prefix_supports: list[dict] | None, field: str) -> Problem | None:
    keep = action.get("selection_keep")
    if keep is None:
        return None
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
