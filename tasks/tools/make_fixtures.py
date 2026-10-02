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

CUSTOMERS = [
    "Alder & Finch", "Brightwater Co", "Cobalt Works", "Dunmore Supply",
    "Elmstead Ltd", "Farrow Goods", "Greyfield Inc", "Harrow Lane",
]  # fmt: skip
REGIONS = {"Alder & Finch": "north", "Brightwater Co": "south", "Cobalt Works": "east",
           "Dunmore Supply": "west", "Elmstead Ltd": "north", "Farrow Goods": "south",
           "Greyfield Inc": "east", "Harrow Lane": "west"}  # fmt: skip
PRODUCTS = {"anchor bolt": 2.40, "brass hinge": 6.75, "cable reel": 48.00,
            "drill bit set": 19.90, "epoxy kit": 12.50, "flange plate": 31.25}  # fmt: skip


def write_csv(name: str, header: list[str], rows: list[list[object]]) -> None:
    with (FIXTURES / name).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def orders() -> None:
    rng = random.Random(20261001)
    rows = []
    start = date(2026, 1, 5)
    for number in range(1, 73):
        customer = rng.choice(CUSTOMERS)
        product = rng.choice(list(PRODUCTS))
        day = start + timedelta(days=rng.randrange(0, 175))
        status = rng.choices(["completed", "cancelled", "refunded"], weights=[80, 12, 8])[0]
        rows.append(
            [f"ORD-{number:04d}", day.isoformat(), customer, REGIONS[customer], product,
             rng.randint(1, 40), f"{PRODUCTS[product]:.2f}", status]  # fmt: skip
        )
    rows.sort(key=lambda row: (row[1], row[0]))
    write_csv(
        "orders.csv",
        ["order_id", "order_date", "customer", "region", "product", "quantity", "unit_price",
         "status"],  # fmt: skip
        rows,
    )


def employees() -> None:
    rng = random.Random(20261002)
    first = ["Ada", "Bram", "Cleo", "Dev", "Esme", "Faisal", "Greta", "Hugo", "Ines", "Jonas",
             "Kira", "Leif", "Mona", "Nico", "Oona", "Pavel", "Quinn", "Rhea", "Sami", "Tova",
             "Uri", "Vera", "Wim", "Xena", "Yara", "Zeno", "Arlo", "Bea"]  # fmt: skip
    last = ["Abara", "Brandt", "Castell", "Dvorak", "Eklund", "Farid", "Greaves", "Halloran",
            "Imura", "Jansen", "Kovacs", "Lindqvist", "Marchetti", "Novak", "Okonkwo", "Petrov",
            "Quispe", "Rahimi", "Soler", "Takeda", "Ueda", "Vasquez", "Whitlock", "Xiong",
            "Yilmaz", "Zamora", "Achterberg", "Bellamy"]  # fmt: skip
    departments = ["Engineering", "Sales", "Support", "Finance"]
    bands = {"Engineering": (78, 132), "Sales": (52, 96), "Support": (44, 70), "Finance": (60, 110)}
    rows = []
    managers: dict[str, int] = {}
    for index in range(28):
        employee_id = 100 + index
        department = departments[index % 4]
        low, high = bands[department]
        salary = rng.randrange(low, high) * 1000 + rng.choice([0, 250, 500, 750])
        started = date(2014, 1, 1) + timedelta(days=rng.randrange(0, 4300))
        if department not in managers:
            managers[department] = employee_id
            manager: object = ""
        else:
            manager = managers[department]
        rows.append([employee_id, f"{first[index]} {last[index]}", department, salary,
                     started.isoformat(), manager])  # fmt: skip
    write_csv(
        "employees.csv",
        ["employee_id", "name", "department", "salary", "start_date", "manager_id"],
        rows,
    )


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
    for build in (orders, employees, sensor_readings, inventory, server_log, notice):
        build()
        print("wrote", build.__name__)
