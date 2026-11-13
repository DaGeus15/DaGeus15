"""Generate still contribution calendars from the published snake grids."""

from pathlib import Path


for animated in Path("dist").glob("github-contribution-grid-snake*.svg"):
    svg = animated.read_text(encoding="utf-8")
    if "</style>" not in svg:
        raise ValueError(f"Missing styles in {animated}")
    still = svg.replace("</style>", ".c,.u,.s{animation:none!important}.s{display:none}</style>", 1)
    animated.with_name(f"{animated.stem}-still.svg").write_text(still, encoding="utf-8")
