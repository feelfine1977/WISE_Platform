"""Profile columns for literal measure sources, so the built purchasing view can review a profile over them.

The four appended columns are constant and carry no analytical meaning for the measures under test; the
existing column indices are unchanged.
"""

PROFILE_HEADERS = ",case Item Type,case Goods Receipt,case GR-Based Inv. Verif.,case Item"
PROFILE_CELLS = ",Standard,true,true,1"
PROFILE_ROLES = {"item_category": 3, "item_type": 9, "goods_receipt": 10, "gr_based_iv": 11, "purchasing_document": 6, "item": 12,
                 "source_case": None}


def with_profile_columns(raw: bytes) -> bytes:
    header, *rows = raw.decode().splitlines()
    return ("\n".join([header + PROFILE_HEADERS, *(row + PROFILE_CELLS for row in rows)]) + "\n").encode()
