#!/usr/bin/env python3
"""Generate the messy fixtures used in the TurboFuzz UX review.

    pip install openpyxl
    python make_test_data.py [outdir]      # default: ./fixtures

Each file targets one failure mode; expected values are in the review doc.
"""
import datetime, random, sys, pathlib
import openpyxl

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures")
out.mkdir(parents=True, exist_ok=True)
random.seed(7)

# 1. euro_win1252.csv — semicolons, decimal commas, dd/mm/yyyy, Windows-1252.
#    Umsatz is 1.00-999.99, so the parsed max should be 999.99 (not 99,999).
lines = ["Kunde;Stadt;Umsatz;Datum;Anteil"]
for _ in range(300):
    d = datetime.date(2024, 1, 1) + datetime.timedelta(days=random.randint(0, 400))
    amt = f"{random.randint(100, 99999) / 100:.2f}".replace(".", ",")
    lines.append(
        f"{random.choice(['Müller','Schäfer','Böhm','Jürgens','Östlund','Núñez','Ångström'])};"
        f"{random.choice(['Köln','Zürich','München','Düsseldorf'])};{amt};"
        f"{d.day:02d}/{d.month:02d}/{d.year};{random.randint(0, 100)} %"
    )
(out / "euro_win1252.csv").write_bytes("\r\n".join(lines).encode("cp1252"))

# 2. ragged.csv — duplicate + blank header names, quoted newline, short/long rows.
#    Expected: 4 data rows. Current: first data row is merged into the header.
(out / "ragged.csv").write_text(
    'id,name,name,,notes\n1,Ann,Ann2,x,"line one\nline two"\n2,Bob,Bob2\n'
    '3,Cy,Cy2,y,ok,EXTRA,EXTRA2\n\n4,Di,Di2,z,"he said ""hi"""\n\n\n'
)

# 3. messy_report.xlsx — title rows, merged header, text-numbers, real dates,
#    leading-zero codes, totals row, second sheet.
#    Expected: Date column is a Date (2024-07-01..2024-08-09), not 45,474..45,513.
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Q3 Report"
ws["A1"] = "ACME PTY LTD — Quarterly Sales Report"
ws["A2"] = "Prepared by Finance — DRAFT"
ws.append([]); ws.append([])
ws.append(["Region", "Sales", "", "Date", "Code"])
ws.merge_cells("B4:C4")
ws["B4"] = "Sales"
ws.append(["", "Actual", "Budget", "", ""])
for i in range(40):
    ws.append([
        random.choice(["WA", "NSW", "VIC"]),
        f"{random.randint(1000, 90000):,}",
        random.randint(1000, 90000),
        datetime.date(2024, 7, 1) + datetime.timedelta(days=i),
        f"00{random.randint(100, 999)}",
    ])
ws.append(["TOTAL", "=SUM(B6:B45)", "=SUM(C6:C45)", None, None])
wb.create_sheet("Notes").append(["note"])
wb.save(out / "messy_report.xlsx")

# 4. messy_values.csv — case/whitespace/typo variants, currency, %, Y/N/yes/TRUE,
#    mixed date formats, -999 sentinel, leading-zero ids, N/A and "-" nulls.
cities = ["Perth", "perth ", "PERTH", "Fremantle", "Fremantel", "Freemantle", "Joondalup", "Joondalup  "]
rows = ["id,city,amount,pct,paid,when,score,flag"]
for i in range(1, 401):
    amt = random.choice([f"${random.randint(100, 9000):,}.{random.randint(0, 99):02d}",
                         f"{random.randint(100, 9000)}", "N/A", "-", ""])
    when = random.choice([f"{random.randint(1, 28):02d}/{random.randint(1, 12):02d}/2024",
                          f"2024-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}",
                          f"{random.randint(1, 28)} Mar 2024"])
    rows.append(
        f'{i:05d},{random.choice(cities)},"{amt}",{random.randint(0, 100)}%,'
        f'{random.choice(["Y", "N", "yes", "TRUE", "no"])},{when},'
        f'{random.choice([random.randint(1, 100), -999, -999])},{random.choice(["a", "b", ""])}'
    )
(out / "messy_values.csv").write_text("\n".join(rows))
print("wrote", *sorted(p.name for p in out.iterdir()), sep="\n  ")
