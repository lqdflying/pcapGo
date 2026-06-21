"""Centralized scapy layer imports for full protocol dissection support.

Import this module before any scapy dissection to ensure all protocol
layers are registered.  Python's import system guarantees the side-effects
(bind_layers calls inside each scapy.layers.* module) run exactly once
per process.
"""

try:
    import scapy.layers.all  # noqa: F401 -- registers all protocol dissectors
except ImportError:
    import scapy.layers.l2  # noqa: F401
    import scapy.layers.inet  # noqa: F401
