"""Generates the synthetic fixture files for the task bank.

Everything here is made up: no real people, companies, or measurements. The
output is deterministic (fixed seeds), and the generated files are committed, so
this script only needs to run again if the fixtures are meant to change. If they
do change, the expected answers in tasks/**/*.yaml must be recomputed; the tests
in apps/api/tests/test_task_bank.py will fail until they match.

Run from the repository root:  python tasks/tools/make_fixtures.py
"""

import csv
import random
from datetime import date, datetime, timedelta
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"

def write_csv(name: str, header: list[str], rows: list[list[object]]) -> None:
    with (FIXTURES / name).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def sensor_readings() -> None:
    rng = random.Random(20261003)
    rows = []
    start = datetime(2026, 6, 1, 0, 0)
    for hour in range(48):
        stamp = (start + timedelta(hours=hour)).strftime("%Y-%m-%dT%H:%M")
        for sensor, base in (("A", 18.0), ("B", 21.5)):
            daily = 4.0 if 9 <= hour % 24 <= 17 else 0.0
            temperature: object = round(base + daily + rng.uniform(-1.2, 1.2), 1)
            if rng.random() < 0.08:
                temperature = ""  # A dropped reading.
            humidity = rng.randint(38, 71)
            rows.append([stamp, sensor, temperature, humidity])
    # One faulty spike on sensor A, far outside the normal range.
    rows[40][2] = 97.4
    write_csv("sensor_readings.csv", ["timestamp", "sensor", "temperature_c", "humidity_pct"], rows)


def inventory() -> None:
    rng = random.Random(20261004)
    items = [("fasteners", ["anchor bolt", "hex nut", "lock washer", "rivet", "wood screw", "toggle"]),
             ("hardware", ["brass hinge", "door stop", "drawer slide", "gate latch", "hasp", "pull"]),
             ("electrical", ["cable reel", "junction box", "wire nut", "conduit", "breaker", "relay"]),
             ("tools", ["drill bit set", "hole saw", "level", "pry bar", "tape measure", "vise"])]  # fmt: skip
    rows = []
    number = 0
    for category, names in items:
        for name in names:
            number += 1
            reorder = rng.choice([10, 20, 25, 40, 50])
            stock = rng.randint(0, 3 * reorder)
            cost = round(rng.uniform(0.4, 62.0), 2)
            rows.append([f"SKU-{number:03d}", name, category, stock, reorder, f"{cost:.2f}"])
    write_csv(
        "inventory.csv", ["sku", "name", "category", "stock", "reorder_point", "unit_cost"], rows
    )


def server_log() -> None:
    """Larger than read_file accepts, so counting its lines needs python_exec."""
    rng = random.Random(20261005)
    services = ["auth", "billing", "catalog", "gateway", "search"]
    messages = {
        "INFO": ["request completed", "cache refreshed", "health check ok", "session started"],
        "WARN": ["slow response", "retrying upstream call", "queue depth high"],
        "ERROR": ["upstream timed out", "database connection lost", "payload rejected"],
    }
    start = datetime(2026, 7, 14, 0, 0, 0)
    lines = []
    for index in range(4200):
        level = rng.choices(["INFO", "WARN", "ERROR"], weights=[86, 10, 4])[0]
        stamp = (start + timedelta(seconds=index * 19)).strftime("%Y-%m-%dT%H:%M:%S")
        service = rng.choice(services)
        lines.append(
            f"{stamp} {level:<5} {service:<8} {rng.choice(messages[level])} "
            f"request_id={rng.randrange(16**8):08x}"
        )
    (FIXTURES / "server.log").write_text("\n".join(lines) + "\n", encoding="utf-8")


def notice() -> None:
    (FIXTURES / "notice.txt").write_text(
        "HARBOR FERRY SERVICE NOTICE\n"
        "Effective 1 September 2026\n\n"
        "From this date ferries leave Pinecrest every 30 minutes between 06:00 and 23:00.\n"
        "The crossing time is unchanged.\n"
        "This notice replaces the timetable printed in earlier guides.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    FIXTURES.mkdir(exist_ok=True)
    for build in (sensor_readings, inventory, server_log, notice):
        build()
        print("wrote", build.__name__)
