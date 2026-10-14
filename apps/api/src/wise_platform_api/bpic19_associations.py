"""Descriptive comparisons of immutable native verdicts, never an evaluator.

All deviations, weights, contributions and witnesses originate in the saved
Method run. These functions count those recorded states and compute explicitly
named finite-population descriptors. They never grade, rescore or fit a norm.
"""
from __future__ import annotations

import math
from statistics import mean, median, stdev
from itertools import combinations

POLICY = "bpic19.frozen_native_associations.v1"


def _finite(value):
    return value if type(value) in {int,float} and math.isfinite(value) else None


def _description(values: list[float]) -> dict:
    return {"count":len(values),"mean":mean(values) if values else None,"median":median(values) if values else None,
            "sum":sum(values) if values else None,
            "sample_sd":stdev(values) if len(values)>=2 else None,
            "sample_sd_reason":None if len(values)>=2 else "insufficient_sample_support"}


def _difference(left, right):
    return left-right if left is not None and right is not None else None


def _pooled(target: list[float], comparator: list[float], requested: bool) -> dict:
    if not requested: return {"value":None,"pooled_sample_sd":None,"reason":"not_requested"}
    if len(target)<2 or len(comparator)<2:
        return {"value":None,"pooled_sample_sd":None,"reason":"insufficient_sample_support"}
    sd=math.sqrt(((len(target)-1)*stdev(target)**2+(len(comparator)-1)*stdev(comparator)**2)/(len(target)+len(comparator)-2))
    if sd==0: return {"value":None,"pooled_sample_sd":0,"reason":"zero_pooled_variance"}
    value=(mean(target)-mean(comparator))/sd
    return {"value":value if math.isfinite(value) else None,"pooled_sample_sd":sd,
            "reason":None if math.isfinite(value) else "nonfinite_magnitude"}


def _native_penalty(case: dict):
    if _finite(case.get("score")) is None: return None
    stored=_finite(case.get("native_penalty"))
    if stored is not None: return stored
    # Compatibility with v2/v3 snapshots: this sums already evaluated native
    # contribution cells; it is not a new score definition.
    cells=[_finite(criterion.get("penalty")) for criterion in case["criteria"]]
    return sum(value for value in cells if value is not None)


def _eligible(verdict: dict) -> bool:
    return (_finite(verdict.get("deviation")) is not None and verdict.get("reason")=="evaluated"
            and (_finite(verdict.get("effective_weight")) or 0)>0)


def _criterion(cases: dict, ids: list[str], key: str, threshold: float) -> dict:
    verdicts={cid:next(c for c in cases[cid]["criteria"] if c["criterion_id"]==key) for cid in ids}
    eligible=[cid for cid in ids if _eligible(verdicts[cid])]
    eligible_set=set(eligible)
    positive=[cid for cid in eligible if verdicts[cid]["deviation"]>threshold]
    unavailable=[cid for cid in ids if cid not in eligible_set]
    raw=[verdicts[cid]["measurement"] for cid in eligible if _finite(verdicts[cid].get("measurement")) is not None]
    values=[verdicts[cid]["deviation"] for cid in eligible]
    units={verdicts[cid].get("measurement_evidence",{}).get("unit") for cid in eligible}
    return {"criterion_id":key,"total_case_count":len(ids),"eligible_case_count":len(eligible),
            "positive_case_count":len(positive),"unavailable_case_count":len(unavailable),
            "known_in_scope_case_count":sum(bool(v["in_scope"]) for v in verdicts.values()),
            "out_of_scope_case_count":sum(v["reason"]=="out_of_scope" for v in verdicts.values()),
            "scope_unknown_case_count":sum(v["reason"]=="scope_unknown" for v in verdicts.values()),
            "eligible_case_ids":eligible,"positive_case_ids":positive,"unavailable_case_ids":unavailable,
            "total_case_prevalence":len(positive)/len(ids) if ids else None,
            "eligible_firing_rate":len(positive)/len(eligible) if eligible else None,
            "eligible_mean_severity":mean(values) if values else None,
            "conditional_positive_severity":mean([verdicts[cid]["deviation"] for cid in positive]) if positive else None,
            "unweighted_severity_sum":sum(values) if values else None,
            "native_contribution_sum":sum(verdicts[cid]["penalty"] for cid in eligible),
            "raw_measurement_statistics":{**_description(raw),"unit":next(iter(units)) if len(units)==1 else None,
                "unit_reason":None if len(units)==1 else "mixed_or_unavailable_units", "eligibility":"native evaluated positive-weight criterion cases"}}


def _dependency(norm: dict, left: str, right: str) -> dict:
    constraints={c["id"]:c for c in norm["constraints"]}
    a,b=constraints[left]["params"].get("attribute"),constraints[right]["params"].get("attribute")
    recipes=norm.get("metadata",{}).get("raw_binding_recipe",{})
    same_selector=(recipes.get(left,{}).get("activities") is not None and
                   recipes.get(left,{}).get("activities")==recipes.get(right,{}).get("activities"))
    return {"flag":"deterministic_derived" if a==b or same_selector else "not_established",
            "left_attribute":a,"right_attribute":b,"left_recipe":recipes.get(left),"right_recipe":recipes.get(right),
            "interpretation":"Shared deterministic input is not evidence of an independent cause."}


def analyse_associations(cases: dict[str,dict], norm: dict, query: dict) -> dict:
    """Use exact resolved membership supplied by the authorized saved-run service."""
    if query["policy_id"]!=POLICY: raise ValueError("This association policy is not admitted.")
    if query["positive_threshold"]!=0: raise ValueError("The admitted positive-deviation threshold is strictly greater than zero.")
    if query["pair_mode"] not in {"jointly_eligible","legacy_total_case"}: raise ValueError("Choose an admitted pair universe.")
    keys=query["criteria"]
    known={c["id"] for c in norm["constraints"]}
    if len(set(keys))!=len(keys) or set(keys)-known: raise ValueError("Choose distinct criteria in the saved native norm.")
    target,comparator=query["target"]["case_ids"],query["comparator"]["case_ids"]
    for ids in (target,comparator):
        if len(set(ids))!=len(ids) or set(ids)-set(cases): raise ValueError("Every selected item must belong once to the saved native run.")
    support=query["min_support"] if query["min_support"] is not None else max(20,int(.02*len(target)))
    if type(support) is not int or support<1: raise ValueError("Minimum support must be a positive integer.")
    populations={}
    values={}
    for name,ids in (("target",target),("comparator",comparator)):
        statistics={key:_criterion(cases,ids,key,0) for key in keys}
        penalties=[{"case_id":cid,"native_penalty":_native_penalty(cases[cid]),"native_score":cases[cid].get("score")} for cid in ids]
        finite=[row["native_penalty"] for row in penalties if row["native_penalty"] is not None]
        populations[name]={"name":query[name]["name"],"case_ids":ids,"case_count":len(ids),"criteria":statistics,
            "native_item_penalties":penalties,"scored_case_count":len(finite),"unscored_case_count":len(ids)-len(finite),
            "native_mean_penalty":mean(finite) if finite else None,"native_penalty_mass":sum(finite) if finite else None}
        values[name]={key:[next(c for c in cases[cid]["criteria"] if c["criterion_id"]==key)["deviation"]
                           for cid in statistics[key]["eligible_case_ids"]] for key in keys}
    pairs=[]
    for left,right in combinations(keys,2):
        a,b=populations["target"]["criteria"][left],populations["target"]["criteria"][right]
        eligible=set(a["eligible_case_ids"])&set(b["eligible_case_ids"])
        universe=set(target) if query["pair_mode"]=="legacy_total_case" else eligible
        afire=set(a["positive_case_ids"])&universe;bfire=set(b["positive_case_ids"])&universe
        intersection,union=afire&bfire,afire|bfire
        pairs.append({"left":left,"right":right,"universe_case_ids":sorted(universe),"universe_case_count":len(universe),
            "jointly_eligible_case_ids":sorted(eligible),"left_positive_case_ids":sorted(afire),"right_positive_case_ids":sorted(bfire),
            "intersection_case_ids":sorted(intersection),"union_case_ids":sorted(union),"support":len(intersection),
            "jaccard":len(intersection)/len(union) if union else None,"jaccard_reason":None if union else "zero_support",
            "lift":len(intersection)*len(universe)/(len(afire)*len(bfire)) if afire and bfire else None,
            "lift_reason":None if afire and bfire else "zero_support", "dependency":_dependency(norm,left,right),
            "suppression_reason":"support_below_minimum" if len(intersection)<support else None})
    contrasts=[]
    for key in keys:
        a,b=populations["target"]["criteria"][key],populations["comparator"]["criteria"][key]
        raw_a,raw_b=a["raw_measurement_statistics"],b["raw_measurement_statistics"]
        unit_matches=raw_a["unit"] is not None and raw_a["unit"]==raw_b["unit"]
        contrasts.append({"criterion_id":key,"mean_difference":_difference(a["eligible_mean_severity"],b["eligible_mean_severity"]),
            "eligible_firing_difference":_difference(a["eligible_firing_rate"],b["eligible_firing_rate"]),
            "total_prevalence_difference":_difference(a["total_case_prevalence"],b["total_case_prevalence"]),
            "target_eligible_count":a["eligible_case_count"],"comparator_eligible_count":b["eligible_case_count"],
            "target_total_count":len(target),"comparator_total_count":len(comparator),
            "pooled_sample_sd_magnitude":_pooled(values["target"][key],values["comparator"][key],query["pooled_sd"]),
            "raw_unit":raw_a["unit"] if unit_matches else None,
            "raw_mean_difference":_difference(raw_a["mean"],raw_b["mean"]) if unit_matches else None,
            "raw_median_difference":_difference(raw_a["median"],raw_b["median"]) if unit_matches else None,
            "raw_unit_reason":None if unit_matches else "mixed_or_unavailable_units"})
    pairs.sort(key=lambda row:(-row["support"],row["left"],row["right"]))
    return {"policy_id":POLICY,"recipe_id":POLICY+"."+query["pair_mode"],"query":query,"minimum_support":support,
        "populations":populations,"accepted_pairs":[p for p in pairs if p["suppression_reason"] is None],
        "suppressed_pairs":[p for p in pairs if p["suppression_reason"] is not None],"contrasts":contrasts,
        "overlapping_case_ids":sorted(set(target)&set(comparator)),
        "formulas":{"prevalence":"positive / total selected cases","eligible_firing":"positive / native evaluated positive-weight cases",
                    "jaccard":"intersection / union within the named pair universe","lift":"intersection * N / (left_positive * right_positive)",
                    "mean_difference":"target eligible mean severity - comparator eligible mean severity",
                    "cohen_d":"mean difference / pooled sample SD, ddof=1; unavailable below two values per set or at zero pooled variance"},
        "legacy_convention":"Unavailable is nonfiring only for the explicitly named legacy pair universe; raw/native unavailable values remain null." if query["pair_mode"]=="legacy_total_case" else None,
        "interpretation":"Descriptive finite-population comparison; no p-values, confidence intervals, independence, causality or savings are inferred."}
