"""Compares this project's SGP4 with python-sgp4, which wraps Vallado's C++.

Run through `npm run crosscheck:python`, which exports the TypeScript states
first. Both sides use the same minutes-from-epoch, so a difference here is a
difference between the propagators and not between epoch parsers.
"""

import json
import math
import os
from importlib.metadata import version
from pathlib import Path

from sgp4 import omm
from sgp4.api import Satrec, accelerated

STATES = Path("results/.ts-states.json")
manifest = json.loads(Path("public/data/manifest.json").read_text())
snapshot = json.loads(Path("public/data", manifest["file"]).read_text())
fields = snapshot["fields"]
catalog = {row[0]: dict(zip(fields, row)) for row in snapshot["rows"]}

worst = (0.0, "", 0.0)
worst_velocity = 0.0
total = 0.0
compared = 0
disagreements = 0
satellites: dict[int, Satrec] = {}

for item in json.loads(STATES.read_text()):
    record = catalog[item["id"]]
    sat = satellites.get(item["id"])
    if sat is None:
        sat = Satrec()
        # OMM epochs must parse identically on both sides. The fields below are
        # required by the parser and do not influence SGP4.
        omm.initialize(
            sat,
            {
                **{k: str(v) for k, v in record.items()},
                "MEAN_MOTION_DOT": "0",
                "MEAN_MOTION_DDOT": "0",
                "EPHEMERIS_TYPE": "0",
                "ELEMENT_SET_NO": "999",
                "REV_AT_EPOCH": "0",
                "CLASSIFICATION_TYPE": "U",
            },
        )
        satellites[item["id"]] = sat
    code, r, v = sat.sgp4_tsince(item["tsince"])
    if code != 0:
        disagreements += 1
        continue
    distance = math.dist(r, item["state"][:3])
    worst_velocity = max(worst_velocity, math.dist(v, item["state"][3:]))
    total += distance
    compared += 1
    if distance > worst[0]:
        worst = (distance, record["OBJECT_NAME"], item["tsince"])

report = {
    "command": "npm run crosscheck:python",
    "reference": f"python-sgp4 {version('sgp4')}, compiled C++ extension: {bool(accelerated)}",
    "note": "Same tsince on both sides, four time offsets per object.",
    "objects": len(satellites),
    "comparedStates": compared,
    "disagreementsOnFailure": disagreements,
    "worstPositionKm": worst[0],
    "worstObject": worst[1],
    "meanPositionKm": total / compared,
    "worstVelocityKmS": worst_velocity,
}
Path("results/crosscheck-python-sgp4.json").write_text(json.dumps(report, indent=2) + "\n")
os.remove(STATES)
print(json.dumps(report, indent=2))
