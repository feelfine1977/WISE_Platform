"""Version of the analytics implementation.

Every answer carries this value. It is not part of any derived identity: an
identity changes only when the source bytes, the parser version or a policy
changes, so a later implementation can reopen what an earlier one identified.
"""

IMPLEMENTATION_VERSION = "0.1.0"
